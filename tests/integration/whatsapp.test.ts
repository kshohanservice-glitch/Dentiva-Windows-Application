import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupEnv, createTestEnv, ownerCtx, type TestEnv } from '../helpers';
import { openDatabase, schemaVersionOf } from '../../src/main/db/database';
import { MIGRATIONS } from '../../src/main/db/migrations';
import { migration006 } from '../../src/main/db/migrations/006_whatsapp';
import { createPatient, getPatient, listPatients, updatePatient } from '../../src/main/services/patients';
import { getSettings, saveSettings } from '../../src/main/services/settings';
import {
  assertSafeWhatsAppOpenUrl,
  deleteWhatsAppTemplate,
  duplicateWhatsAppTemplate,
  listPatientDocuments,
  listWhatsAppHistory,
  listWhatsAppTemplates,
  prepareWhatsAppDocuments,
  prepareWhatsAppMessage,
  recordWhatsAppStatus,
  restoreWhatsAppTemplate,
  saveWhatsAppTemplate,
} from '../../src/main/services/whatsapp';
import { DEFAULT_WHATSAPP_TEMPLATES, MAX_WHATSAPP_LINK_LENGTH } from '../../src/shared/whatsapp';

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'v3.0.3', 'dentiva-v3.0.3.db');

let env: TestEnv;

beforeEach(() => {
  env = createTestEnv('whatsapp');
});

afterEach(() => {
  cleanupEnv(env);
});

function seedPatient(overrides: Record<string, unknown> = {}) {
  const ctx = ownerCtx(env);
  return createPatient(ctx, {
    name: 'Rahima Akter', bengaliName: 'রহিমা আক্তার', gender: 'female', ageYears: 32,
    phone: '01712345678', ...overrides,
  });
}

function seedDentist(): number {
  const now = new Date().toISOString();
  const info = env.db.prepare("INSERT INTO dentists (name, created_at, updated_at) VALUES ('Dr. Test Dentist', ?, ?)").run(now, now);
  return Number(info.lastInsertRowid);
}

describe('migration 006', () => {
  it('brings a fresh database to schema 6 with additive WhatsApp storage', () => {
    expect(schemaVersionOf(env.db)).toBe(MIGRATIONS[MIGRATIONS.length - 1].version);
    const columns = (env.db.prepare('PRAGMA table_info(patients)').all() as { name: string }[]).map((c) => c.name);
    expect(columns).toContain('whatsapp_number');
    expect(columns).toContain('whatsapp_same_as_phone');
    expect(columns).toContain('whatsapp_consent');
    const tables = (env.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name);
    expect(tables).toContain('whatsapp_templates');
    expect(tables).toContain('whatsapp_message_log');
    expect(listWhatsAppTemplates(ownerCtx(env))).toHaveLength(DEFAULT_WHATSAPP_TEMPLATES.length);
  });

  it('migrates a v3.0.3 database without inventing numbers or consent', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dentiva-wa-legacy-'));
    const file = path.join(dir, 'legacy.db');
    fs.copyFileSync(FIXTURE, file);
    const { db } = openDatabase(file);
    try {
      expect(schemaVersionOf(db)).toBe(MIGRATIONS[MIGRATIONS.length - 1].version);
      const row = db.prepare('SELECT whatsapp_number, whatsapp_consent FROM patients LIMIT 1').get() as
        { whatsapp_number: string | null; whatsapp_consent: string } | undefined;
      if (row) {
        expect(row.whatsapp_number).toBeNull();
        expect(row.whatsapp_consent).toBe('unknown');
      }
      const count = (db.prepare('SELECT COUNT(*) c FROM whatsapp_templates').get() as { c: number }).c;
      expect(count).toBe(DEFAULT_WHATSAPP_TEMPLATES.length);
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('re-running the migration never overwrites an edited default template', () => {
    const ctx = ownerCtx(env);
    const customised = 'CUSTOMISED BODY {{রোগীর_নাম}}';
    env.db.prepare("UPDATE whatsapp_templates SET body = ? WHERE key = 'appointment_reminder'").run(customised);
    migration006.up(env.db);
    const templates = listWhatsAppTemplates(ctx);
    expect(templates.find((t) => t.key === 'appointment_reminder')?.body).toBe(customised);
    expect(templates).toHaveLength(DEFAULT_WHATSAPP_TEMPLATES.length);
  });
});

describe('patient WhatsApp number', () => {
  it('stores a normalized WhatsApp number separately from the phone', () => {
    const p = seedPatient({ whatsappNumber: '01712345678' });
    expect(p.whatsappNumber).toBe('8801712345678');
    expect(p.phone).toBe('01712345678');
    expect(p.whatsappConsent).toBe('unknown');
    expect(getPatient(ownerCtx(env), p.id).whatsappNumber).toBe('8801712345678');
    expect(listPatients(ownerCtx(env), { query: '8801712345678', range: 'all' }).total).toBe(1);
  });

  it('derives the WhatsApp number only when same-as-phone is ticked', () => {
    const same = seedPatient({ phone: '01812345678', whatsappSameAsPhone: true });
    expect(same.whatsappNumber).toBe('8801812345678');
    const independent = seedPatient({ name: 'Second Patient', phone: '01912345678', whatsappNumber: '+44 20 7946 0958' });
    expect(independent.whatsappNumber).toBe('442079460958');
  });

  it('leaves the WhatsApp number empty for patients who have none', () => {
    const p = seedPatient();
    expect(p.whatsappNumber).toBeNull();
  });

  it('rejects invalid WhatsApp numbers and preserves an independent number on edit', () => {
    const ctx = ownerCtx(env);
    expect(() => seedPatient({ whatsappNumber: '12345' })).toThrow(/WhatsApp/);
    const p = seedPatient({ whatsappNumber: '01712345678' });
    const renamed = updatePatient(ctx, p.id, { name: 'Rahima Akter Renamed', gender: 'female' });
    expect(renamed.whatsappNumber).toBe('8801712345678');
    const changed = updatePatient(ctx, p.id, {
      name: 'Rahima Akter Renamed', gender: 'female', whatsappNumber: '+8801912345678', whatsappConsent: 'granted',
    });
    expect(changed.whatsappNumber).toBe('8801912345678');
    expect(changed.whatsappConsent).toBe('granted');
    expect(changed.whatsappConsentAt).not.toBeNull();
  });
});

describe('patient document registry', () => {
  it('lists only the selected patient\'s printable documents', () => {
    const ctx = ownerCtx(env);
    const a = seedPatient({ whatsappNumber: '01712345678', whatsappConsent: 'granted' });
    const b = seedPatient({ name: 'Other Patient', phone: '01812345678' });
    const dentistId = seedDentist();
    const now = new Date().toISOString();
    env.db.prepare(
      "INSERT INTO prescriptions (number, patient_id, dentist_id, date, created_by, created_at) VALUES ('RX-1', ?, ?, '2026-09-01', 1, ?)",
    ).run(a.id, dentistId, now);
    env.db.prepare(
      "INSERT INTO invoices (number, patient_id, date, total_paisa, created_by, created_at) VALUES ('INV-1', ?, '2026-09-02', 150000, 1, ?)",
    ).run(a.id, now);
    const invoiceId = Number((env.db.prepare("SELECT id FROM invoices WHERE number = 'INV-1'").get() as { id: number }).id);
    env.db.prepare(
      "INSERT INTO payments (invoice_id, patient_id, amount_paisa, method, received_by, paid_at, created_at) VALUES (?, ?, 150000, 'cash', 1, '2026-09-02T10:00:00.000Z', ?)",
    ).run(invoiceId, a.id, now);
    env.db.prepare(
      "INSERT INTO visits (patient_id, dentist_id, datetime, created_by, created_at, updated_at) VALUES (?, ?, '2026-09-01T09:00:00.000Z', 1, ?, ?)",
    ).run(a.id, dentistId, now, now);
    env.db.prepare(
      "INSERT INTO appointments (patient_id, dentist_id, date, time, created_by, created_at, updated_at) VALUES (?, ?, '2026-12-01', '10:30', 1, ?, ?)",
    ).run(a.id, dentistId, now, now);

    const docsA = listPatientDocuments(ctx, a.id);
    expect(docsA.map((d) => d.kind).sort()).toEqual(['appointment-card', 'invoice', 'prescription', 'receipt', 'visit-summary']);
    expect(docsA.find((d) => d.kind === 'invoice')).toMatchObject({ reference: 'INV-1', amountPaisa: 150000 });
    expect(docsA.find((d) => d.kind === 'prescription')).toMatchObject({ reference: 'RX-1', date: '2026-09-01' });
    expect(listPatientDocuments(ctx, b.id)).toEqual([]);
  });
});

describe('message preparation', () => {
  it('renders the Bengali reminder with real data and a wa.me URL', () => {
    const ctx = ownerCtx(env);
    const p = seedPatient({ whatsappNumber: '01712345678', whatsappConsent: 'granted' });
    const dentistId = seedDentist();
    const now = new Date().toISOString();
    env.db.prepare(
      "INSERT INTO appointments (patient_id, dentist_id, date, time, type, notes, created_by, created_at, updated_at) VALUES (?, ?, '2026-12-05', '10:30', 'consultation', 'Tooth pain review', 1, ?, ?)",
    ).run(p.id, dentistId, now, now);
    const appointmentId = Number((env.db.prepare('SELECT MAX(id) id FROM appointments').get() as { id: number }).id);

    const result = prepareWhatsAppMessage(ctx, { patientId: p.id, category: 'appointment_reminder', appointmentId });
    expect(result.destination).toBe('8801712345678');
    expect(result.url.startsWith('https://wa.me/8801712345678?text=')).toBe(true);
    const decoded = decodeURIComponent(result.url.split('?text=')[1]);
    expect(decoded).toBe(result.message);
    expect(decoded).toContain('রহিমা আক্তার');
    expect(decoded).toContain('5 Dec 2026');
    expect(decoded).toContain('10:30 AM');
    expect(decoded).not.toContain('{{');
    expect(result.greeting).toBeTruthy();
    expect(decoded.startsWith(`${result.greeting},`)).toBe(true);

    const history = listWhatsAppHistory(ctx, p.id);
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe('prepared');
    const reported = recordWhatsAppStatus(ctx, history[0].id, 'sent');
    expect(reported.status).toBe('sent');
  });

  it('refuses appointments and documents belonging to another patient', () => {
    const ctx = ownerCtx(env);
    const a = seedPatient({ whatsappNumber: '01712345678', whatsappConsent: 'granted' });
    const b = seedPatient({ name: 'Other Patient', phone: '01812345678', whatsappNumber: '01812345678', whatsappConsent: 'granted' });
    const now = new Date().toISOString();
    env.db.prepare(
      "INSERT INTO appointments (patient_id, date, time, created_by, created_at, updated_at) VALUES (?, '2026-12-05', '10:30', 1, ?, ?)",
    ).run(b.id, now, now);
    const bAppointment = Number((env.db.prepare('SELECT MAX(id) id FROM appointments').get() as { id: number }).id);
    expect(() => prepareWhatsAppMessage(ctx, { patientId: a.id, category: 'appointment_reminder', appointmentId: bAppointment }))
      .toThrow(/does not belong to this patient/);
  });

  it('blocks declined consent, warns on unrecorded consent, and requires a number', () => {
    const ctx = ownerCtx(env);
    const declined = seedPatient({ whatsappNumber: '01712345678', whatsappConsent: 'declined' });
    expect(() => prepareWhatsAppMessage(ctx, { patientId: declined.id, category: 'custom' })).toThrow(/declined/);
    const unknown = seedPatient({ name: 'Unknown Consent', phone: '01912345678', whatsappNumber: '01912345678' });
    const warned = prepareWhatsAppMessage(ctx, { patientId: unknown.id, category: 'custom', customBody: 'Test body', dryRun: true });
    expect(warned.warnings.join(' ')).toMatch(/consent has not been recorded/);
    const noNumber = seedPatient({ name: 'No Number', phone: '01512345678' });
    expect(() => prepareWhatsAppMessage(ctx, { patientId: noNumber.id, category: 'custom' })).toThrow(/WhatsApp number is missing/);
  });

  it('prepares documents for manual sharing without claiming attachment', () => {
    const ctx = ownerCtx(env);
    const p = seedPatient({ whatsappNumber: '01712345678', whatsappConsent: 'granted' });
    const now = new Date().toISOString();
    env.db.prepare(
      "INSERT INTO invoices (number, patient_id, date, total_paisa, created_by, created_at) VALUES ('INV-9', ?, '2026-09-02', 42000, 1, ?)",
    ).run(p.id, now);
    const invoiceId = Number((env.db.prepare("SELECT id FROM invoices WHERE number = 'INV-9'").get() as { id: number }).id);
    const share = prepareWhatsAppDocuments(ctx, { patientId: p.id, documents: [{ kind: 'invoice', documentId: invoiceId }] });
    expect(share.documents).toHaveLength(1);
    expect(share.documents[0].reference).toBe('INV-9');
    expect(share.introMessage).toContain('রহিমা আক্তার');
    expect(fs.existsSync(path.join(share.shareFolder, 'SHARE-MANIFEST.txt'))).toBe(true);
    const manifest = fs.readFileSync(path.join(share.shareFolder, 'SHARE-MANIFEST.txt'), 'utf8');
    expect(manifest).toContain('attach the PDF files manually');
    const other = seedPatient({ name: 'Other Patient', phone: '01812345678', whatsappNumber: '01812345678', whatsappConsent: 'granted' });
    expect(() => prepareWhatsAppDocuments(ctx, { patientId: other.id, documents: [{ kind: 'invoice', documentId: invoiceId }] }))
      .toThrow(/does not belong to this patient/);
  });

  it('enforces the message limit on the rendered path, not only on edited text', () => {
    const ctx = ownerCtx(env);
    const p = seedPatient({ whatsappNumber: '01712345678', whatsappConsent: 'granted' });
    const tpl = saveWhatsAppTemplate(ctx, {
      name: 'Long body review', category: 'custom',
      body: `${'ক'.repeat(3900)}{{বার্তার_মূল_বিষয়}}`,
    });

    // Rendered template + custom body: the final message is what counts.
    expect(() => prepareWhatsAppMessage(ctx, {
      patientId: p.id, category: 'custom', templateId: tpl.id, customBody: 'খ'.repeat(1000), dryRun: true,
    })).toThrow(/Message is too long \(max 4000 characters\)/);

    // The custom body is bounded as well, so the error names the real culprit.
    expect(() => prepareWhatsAppMessage(ctx, {
      patientId: p.id, category: 'custom', customBody: 'খ'.repeat(4001), dryRun: true,
    })).toThrow(/Custom message body is too long \(max 4000 characters\)/);
  });

  it('accepts exactly the maximum message and refuses one character more', () => {
    const ctx = ownerCtx(env);
    const p = seedPatient({ whatsappNumber: '01712345678', whatsappConsent: 'granted' });

    // A template that is nothing but the custom-body placeholder, so the
    // rendered message length equals the custom body length exactly.
    const bodyOnly = saveWhatsAppTemplate(ctx, {
      name: 'Body only', category: 'custom', body: '{{বার্তার_মূল_বিষয়}}',
    });
    const atLimit = prepareWhatsAppMessage(ctx, {
      patientId: p.id, category: 'custom', templateId: bodyOnly.id, customBody: 'ক'.repeat(4000), dryRun: true,
    });
    expect(atLimit.message).toHaveLength(4000);
    expect(atLimit.url.length).toBeLessThanOrEqual(MAX_WHATSAPP_LINK_LENGTH);
    expect(() => assertSafeWhatsAppOpenUrl(atLimit.url)).not.toThrow();
    expect(atLimit.warnings.join(' ')).not.toMatch(/invalid text characters/i);

    // One character more is refused by the unified post-render check…
    expect(() => prepareWhatsAppMessage(ctx, {
      patientId: p.id, category: 'custom', templateId: bodyOnly.id, customBody: 'খ'.repeat(4001), dryRun: true,
    })).toThrow(/Custom message body is too long \(max 4000 characters\)/);
    // …and the same limit applies to text the doctor edited by hand.
    expect(() => prepareWhatsAppMessage(ctx, {
      patientId: p.id, category: 'custom', dryRun: true, messageOverride: 'ক'.repeat(4001),
    })).toThrow(/Message is too long \(max 4000 characters\)/);
  });

  it('refuses a Share-PDF introduction that would produce an unopenable link', () => {
    const ctx = ownerCtx(env);
    const p = seedPatient({ whatsappNumber: '01712345678', whatsappConsent: 'granted' });
    const now = new Date().toISOString();
    env.db.prepare(
      "INSERT INTO invoices (number, patient_id, date, total_paisa, created_by, created_at) VALUES ('INV-77', ?, '2026-09-02', 42000, 1, ?)",
    ).run(p.id, now);
    const invoiceId = Number((env.db.prepare("SELECT id FROM invoices WHERE number = 'INV-77'").get() as { id: number }).id);

    // A long clinic address plus a long PDF-introduction template pushes the
    // rendered introduction past the message limit.
    saveSettings(ctx, { clinic: { clinicName: 'BrightSmile Dental Clinic', address: 'A'.repeat(300) } } as any);
    const intro = listWhatsAppTemplates(ctx).find((t) => t.category === 'pdf_introduction')!;
    saveWhatsAppTemplate(ctx, {
      id: intro.id, name: intro.name, category: intro.category,
      body: `${'ক'.repeat(3900)}{{ক্লিনিকের_ঠিকানা}}`,
    });

    expect(() => prepareWhatsAppDocuments(ctx, { patientId: p.id, documents: [{ kind: 'invoice', documentId: invoiceId }] }))
      .toThrow(/Message is too long \(max 4000 characters\)/);
    // Nothing was prepared for sharing, so no temporary folder was created.
    expect(fs.existsSync(path.join(env.paths.tempDir, 'whatsapp'))).toBe(false);
  });

  it('repairs malformed text instead of failing, and says so', () => {
    const ctx = ownerCtx(env);
    const p = seedPatient({ whatsappNumber: '01712345678', whatsappConsent: 'granted' });
    const withSurrogate = prepareWhatsAppMessage(ctx, {
      patientId: p.id, category: 'custom', dryRun: true,
      messageOverride: `শুভ সকাল \uD800 ${'ক'.repeat(5)}`,
    });
    expect(withSurrogate.message).not.toMatch(/[\uD800-\uDFFF]/u);
    expect(withSurrogate.message).toContain('\uFFFD');
    expect(withSurrogate.warnings.join(' ')).toMatch(/invalid text characters/i);
    expect(() => assertSafeWhatsAppOpenUrl(withSurrogate.url)).not.toThrow();

    // Valid multilingual text is never altered or warned about.
    const valid = `শুভ সকাল রহিমা — दंत चिकित्सा 🙂 مرحبا`;
    const untouched = prepareWhatsAppMessage(ctx, {
      patientId: p.id, category: 'custom', dryRun: true, messageOverride: valid,
    });
    expect(untouched.message).toBe(valid);
    expect(untouched.warnings.join(' ')).not.toMatch(/invalid text characters/i);
    expect(decodeURIComponent(untouched.url.split('?text=')[1])).toBe(valid);
  });

  it('rejects unsafe external links', () => {
    expect(assertSafeWhatsAppOpenUrl('https://wa.me/8801712345678?text=hello')).toContain('wa.me');
    expect(() => assertSafeWhatsAppOpenUrl('https://evil.example/8801712345678')).toThrow(/unsafe|invalid/);
    expect(() => assertSafeWhatsAppOpenUrl('javascript:alert(1)')).toThrow(/unsafe|invalid/);
  });
});

describe('template manager', () => {
  it('supports create, duplicate, disable, restore and delete without touching customs on restore', () => {
    const ctx = ownerCtx(env);
    const custom = saveWhatsAppTemplate(ctx, {
      name: 'Post-treatment care', category: 'custom',
      body: '{{সময়ের_গ্রিটিং}}, {{রোগীর_নাম}}।\n\nযত্ন নিন।',
    });
    expect(custom.isDefault).toBe(false);
    const copy = duplicateWhatsAppTemplate(ctx, custom.id);
    expect(copy.name).toContain('copy');
    expect(() => saveWhatsAppTemplate(ctx, { name: 'Bad', category: 'custom', body: '{{nonexistent}}' })).toThrow(/unknown placeholders/i);

    const defaults = listWhatsAppTemplates(ctx).filter((t) => t.isDefault);
    const reminder = defaults.find((t) => t.key === 'appointment_reminder')!;
    saveWhatsAppTemplate(ctx, { id: reminder.id, name: reminder.name, category: reminder.category, body: 'EDITED {{রোগীর_নাম}}' });
    expect(listWhatsAppTemplates(ctx).find((t) => t.id === reminder.id)?.body).toContain('EDITED');
    const restored = restoreWhatsAppTemplate(ctx, reminder.id);
    expect(restored.body).toBe(DEFAULT_WHATSAPP_TEMPLATES.find((t) => t.key === 'appointment_reminder')?.body);
    expect(listWhatsAppTemplates(ctx).find((t) => t.id === custom.id)?.name).toBe('Post-treatment care');

    expect(() => deleteWhatsAppTemplate(ctx, reminder.id)).toThrow(/cannot be deleted/);
    expect(deleteWhatsAppTemplate(ctx, custom.id)).toEqual({ ok: true });
  });

  it('persists the greeting configuration through settings', () => {
    const ctx = ownerCtx(env);
    saveSettings(ctx, {
      whatsapp: {
        timezone: 'Asia/Dhaka',
        greetingRanges: [{ start: '00:00', end: '23:59', greeting: 'শুভ সকাল' }],
      },
    } as any);
    const settings = getSettings(ctx);
    expect(settings.whatsapp.timezone).toBe('Asia/Dhaka');
    expect(settings.whatsapp.greetingRanges).toHaveLength(1);
    expect(() => saveSettings(ctx, { whatsapp: { timezone: 'Not/AZone', greetingRanges: [{ start: '00:00', end: '01:00', greeting: 'শুভ সকাল' }] } } as any))
      .toThrow(/time zone/);
  });
});
