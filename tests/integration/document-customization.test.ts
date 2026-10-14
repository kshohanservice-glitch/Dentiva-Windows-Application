/**
 * Feature A + B integration tests at the service seam.
 *
 * Feature A — the customization map is stored and served through the existing
 * settings architecture: validated on the way in, validated again on the way
 * out, and incapable of disturbing any other setting.
 *
 * Feature B — a walk-in document is prepared in the main process, held in
 * memory, rendered by the print window and then discarded. These tests assert
 * the part that matters legally and operationally: **no patient, invoice,
 * prescription, payment, visit or appointment row is ever created**, the audit
 * trail records that a document was prepared (and nothing clinical), and the
 * permission model is enforced in the service, not just in the UI.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupEnv, createTestEnv, ownerCtx, sessionWith, type TestEnv } from '../helpers';
import { getSettings, saveSettings } from '../../src/main/services/settings';
import { saveDentist } from '../../src/main/services/staff';
import {
  clearQuickDocuments, prepareQuickDocument, quickDocumentCount, readQuickDocument,
} from '../../src/main/services/quick-documents';
import { documentStyleCss } from '../../src/shared/document-styles';
import { QUICK_DOCUMENT_DEFS, type QuickDocumentKind } from '../../src/shared/quick-documents';
import type { Ctx } from '../../src/main/core/context';

let env: TestEnv;

beforeEach(() => {
  env = createTestEnv('documents-v412');
  clearQuickDocuments();
});

afterEach(() => {
  clearQuickDocuments();
  cleanupEnv(env);
});

const countOf = (kind: 'patients' | 'invoices' | 'prescriptions' | 'payments' | 'visits' | 'appointments'): number =>
  Number((env.db.prepare(`SELECT COUNT(*) n FROM ${kind}`).get() as { n: number }).n);

function quickPayload(kind: QuickDocumentKind, extra: Record<string, unknown> = {}): unknown {
  const base = {
    reference: `${QUICK_DOCUMENT_DEFS[kind].referencePrefix}-20261014-090507`,
    date: '2026-10-14',
    customer: { name: 'Walk-in Customer', phone: '01711111111', ageYears: 30, gender: 'Male' },
  };
  const perKind: Record<QuickDocumentKind, Record<string, unknown>> = {
    prescription: { dentistName: 'Dr. Ayesha Rahman', cC: 'Pain', items: [{ medicineName: 'Amoxicillin', strength: '500mg' }] },
    invoice: { lines: [{ description: 'Scaling', qty: 1, unitPricePaisa: 150000, discountPaisa: 0 }], amountReceivedPaisa: 100000, method: 'Cash' },
    receipt: { amountPaisa: 100000, method: 'Cash' },
    'visit-summary': { chiefComplaint: 'Pain', procedures: [{ treatmentName: 'Scaling', qty: 1, unitPricePaisa: 150000 }] },
    'appointment-card': { time: '10:30', purpose: 'Scaling' },
  };
  return { kind, payload: { ...base, ...perKind[kind], ...extra } };
}

describe('Feature A — document customizations persist through settings', () => {
  it('saves and returns validated customizations', () => {
    const ctx = ownerCtx(env);
    const saved = saveSettings(ctx, {
      documentStyles: {
        invoice: { 'invoice.body.title': { fontSize: 18, color: '#112233' } },
      },
    });
    expect(saved.documentStyles).toEqual({ invoice: { 'invoice.body.title': { color: '#112233', fontSize: 18 } } });
    expect(getSettings(ctx).documentStyles).toEqual(saved.documentStyles);

    // Stored as JSON under its own settings key — no schema change, and the
    // generated stylesheet can only ever target the tagged element.
    const row = env.db.prepare("SELECT value_json FROM settings WHERE key = 'documentStyles'").get() as { value_json: string };
    expect(JSON.parse(row.value_json)).toEqual(saved.documentStyles);
    const css = documentStyleCss(getSettings(ctx).documentStyles);
    expect(css).toContain('[data-doc-el="invoice.body.title"]');
  });

  it('drops unknown elements and out-of-range values instead of storing them', () => {
    const ctx = ownerCtx(env);
    const saved = saveSettings(ctx, {
      documentStyles: {
        invoice: {
          'invoice.body.title': { fontSize: 9999, color: 'red' },
          'invoice.invented.element': { fontSize: 12 },
        },
        receipt: { 'receipt.body.title': { fontSize: 14 } },
      },
    } as any);
    expect(saved.documentStyles).toEqual({
      invoice: { 'invoice.body.title': { fontSize: 48 } },
      receipt: { 'receipt.body.title': { fontSize: 14 } },
    });
  });

  it('leaves every other setting untouched', () => {
    const ctx = ownerCtx(env);
    saveSettings(ctx, { clinic: { clinicName: 'BrightSmile Dental' } as any, prescription: { footerMessage: 'See you soon' } as any });
    const before = getSettings(ctx);
    saveSettings(ctx, { documentStyles: { report: { 'report.body.title': { fontSize: 20 } } } });
    const after = getSettings(ctx);
    expect(after.clinic.clinicName).toBe(before.clinic.clinicName);
    expect(after.prescription.footerMessage).toBe(before.prescription.footerMessage);
    expect(after.printProfiles).toEqual(before.printProfiles);
    expect(after.whatsapp).toEqual(before.whatsapp);
    expect(after.documentStyles).toEqual({ report: { 'report.body.title': { fontSize: 20 } } });
  });

  it('returns an empty map for an installation that never customized anything', () => {
    expect(getSettings(ownerCtx(env)).documentStyles).toEqual({});
    expect(documentStyleCss(getSettings(ownerCtx(env)).documentStyles)).toBe('');
  });

  it('requires settings.manage to change customizations', () => {
    const limited: Ctx = { db: env.db, paths: env.paths, session: sessionWith(['patients.view']) };
    expect(() => saveSettings(limited, { documentStyles: { invoice: { 'invoice.body.title': { fontSize: 12 } } } })).toThrow(/settings\.manage/);
    expect(getSettings(limited).documentStyles).toEqual({});
  });
});

describe('Feature B — preparing a quick document', () => {
  it('validates, holds the document in memory and creates no database rows', () => {
    const ctx = ownerCtx(env);
    const before = {
      patients: countOf('patients'), invoices: countOf('invoices'), prescriptions: countOf('prescriptions'),
      payments: countOf('payments'), visits: countOf('visits'), appointments: countOf('appointments'),
    };
    const prepared = prepareQuickDocument(ctx, quickPayload('prescription'));
    expect(prepared.reference).toMatch(/^QP-\d{8}-\d{6}$/);
    expect(quickDocumentCount()).toBe(1);

    const stored = readQuickDocument(ctx, prepared.token);
    expect(stored.kind).toBe('prescription');
    expect(stored.payload.customer.name).toBe('Walk-in Customer');

    expect({
      patients: countOf('patients'), invoices: countOf('invoices'), prescriptions: countOf('prescriptions'),
      payments: countOf('payments'), visits: countOf('visits'), appointments: countOf('appointments'),
    }).toEqual(before);
  });

  it('covers every quick document type without writing anything', () => {
    const ctx = ownerCtx(env);
    for (const kind of Object.keys(QUICK_DOCUMENT_DEFS) as QuickDocumentKind[]) {
      const prepared = prepareQuickDocument(ctx, quickPayload(kind));
      expect(readQuickDocument(ctx, prepared.token).kind).toBe(kind);
    }
    expect(quickDocumentCount()).toBe(5);
    expect(countOf('patients')).toBe(0);
    expect(countOf('invoices')).toBe(0);
  });

  it('rejects an incomplete document before it can be printed', () => {
    const ctx = ownerCtx(env);
    expect(() => prepareQuickDocument(ctx, { kind: 'prescription', payload: { reference: 'QP-1', date: '2026-10-14', customer: { name: '' }, items: [] } }))
      .toThrow(/Customer name is required/);
    expect(quickDocumentCount()).toBe(0);
  });

  it('enforces the create and print permissions in the service', () => {
    // May create a prescription but not print it.
    const noPrint: Ctx = { db: env.db, paths: env.paths, session: sessionWith(['clinical.prescription.create']) };
    expect(() => prepareQuickDocument(noPrint, quickPayload('prescription'))).toThrow(/clinical\.prescription\.print/);

    // May print but not create invoices.
    const noCreate: Ctx = { db: env.db, paths: env.paths, session: sessionWith(['billing.invoice.view']) };
    expect(() => prepareQuickDocument(noCreate, quickPayload('invoice'))).toThrow(/billing\.invoice\.create/);

    // Nothing was stored by the denied attempts.
    expect(quickDocumentCount()).toBe(0);
  });

  it('requires the print permission to read a prepared document back', () => {
    const ctx = ownerCtx(env);
    const prepared = prepareQuickDocument(ctx, quickPayload('receipt'));
    const limited: Ctx = { db: env.db, paths: env.paths, session: sessionWith(['billing.payment.create']) };
    expect(() => readQuickDocument(limited, prepared.token)).toThrow(/billing\.payment\.view/);
  });

  it('refuses an unknown or missing token', () => {
    const ctx = ownerCtx(env);
    expect(() => readQuickDocument(ctx, 'qd-unknown')).toThrow(/expired/);
    expect(() => readQuickDocument(ctx, '')).toThrow(/Missing quick-document reference/);
    expect(() => readQuickDocument(ctx, 42)).toThrow(/Missing quick-document reference/);
  });

  it('resolves the selected dentist from the clinic dentist list', () => {
    const ctx = ownerCtx(env);
    const dentist = saveDentist(ctx, { name: 'Dr. Ayesha Rahman', qualifications: 'BDS', designations: 'Consultant', regNo: 'BMDC-1' });
    // No typed name: the credentials come from the dentist record itself.
    const prepared = prepareQuickDocument(ctx, quickPayload('prescription', { dentistId: dentist.id, dentistName: null }));
    const stored = readQuickDocument(ctx, prepared.token);
    expect(stored.dentist?.name).toBe('Dr. Ayesha Rahman');
    expect(stored.dentist?.regNo).toBe('BMDC-1');
    expect(stored.dentist?.signaturePath).toBeNull();

    // A dentist that has disappeared cannot be printed.
    expect(() => prepareQuickDocument(ctx, quickPayload('prescription', { dentistId: 9999, dentistName: null })))
      .toThrow(/no longer exists/);
  });

  it('records an audit entry naming only the document and its reference', () => {
    const ctx = ownerCtx(env);
    const prepared = prepareQuickDocument(ctx, quickPayload('invoice'));
    const entry = env.db
      .prepare("SELECT action, entity_type, summary FROM audit_log WHERE action = 'document.quick.prepare'")
      .get() as { action: string; entity_type: string; summary: string };
    expect(entry.entity_type).toBe('quick_document');
    expect(entry.summary).toContain(prepared.reference);
    expect(entry.summary).toContain('Quick invoice');
    // No clinical or financial content in the trail.
    expect(entry.summary).not.toContain('Scaling');
    expect(entry.summary).not.toContain('Walk-in Customer');
  });

  it('does not require or expose a patient record for any quick document', () => {
    const ctx = ownerCtx(env);
    const prepared = prepareQuickDocument(ctx, quickPayload('visit-summary'));
    const stored = readQuickDocument(ctx, prepared.token);
    expect(JSON.stringify(stored)).not.toMatch(/patient_?Id|patientCode|patient_code/i);
  });
});
