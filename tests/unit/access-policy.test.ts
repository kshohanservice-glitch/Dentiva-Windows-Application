/**
 * v5 Phase 2 — IPC access policy (V5-003, V5-010), navigation policy (V5-004)
 * and the IPC contract completeness check (parity K-01).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { IPC } from '../../src/shared/ipc';
import { DEMO_ALLOWED_CHANNELS, isDemoAllowed, isPrintableKind, printWindowPermissions, PRINTABLE_KINDS } from '../../src/main/ipc/access-policy';
import { isAppEntryUrl } from '../../src/main/navigation';
import { REPORT_DEFS } from '../../src/shared/reports';
import { isPermissionKey } from '../../src/shared/permissions';

const ROOT = path.resolve(__dirname, '..', '..');
const router = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipc', 'router.ts'), 'utf8');
const invokeChannels = Object.entries(IPC).filter(([, ch]) => !ch.startsWith('event/'));

describe('IPC contract (parity K-01)', () => {
  it('every invoke channel has exactly one main-process handler', () => {
    for (const [key] of invokeChannels) {
      const count = router.split(`handle(IPC.${key},`).length - 1;
      expect(count, `handler count for IPC.${key}`).toBe(1);
    }
  });
});

describe('V5-003 demo mode is an allow-list', () => {
  const MUTATING = [
    'patients/create', 'patients/update', 'patients/archive', 'patients/delete',
    'visits/create', 'visits/update', 'visits/delete', 'chart/set', 'chart/delete',
    'invoices/create', 'invoices/void', 'invoices/delete', 'payments/create', 'payments/delete',
    'accounting/delete-category', 'accounting/save-category',
    'users/save', 'users/delete', 'users/reset-password', 'roles/save', 'roles/remove',
    'backup/run', 'backup/restore', 'backup/set-auto',
    'settings/save', 'settings/upload-logo', 'settings/reset-business',
    'whatsapp/templates/save', 'whatsapp/templates/duplicate', 'whatsapp/templates/delete',
    'whatsapp/templates/set-enabled', 'whatsapp/templates/restore', 'whatsapp/prepare',
    'whatsapp/prepare-documents', 'whatsapp/history/status',
    'quick-documents/prepare', 'notifications/mark-read', 'activation/verify', 'setup/complete',
    'auth/change-password', 'auth/logout', 'system/lock', 'auth/unlock',
  ];

  it('refuses every mutating channel, including those the old block-list missed', () => {
    for (const ch of MUTATING) {
      expect(Object.values(IPC)).toContain(ch);
      expect(isDemoAllowed(ch), ch).toBe(false);
    }
  });

  it('allows the read-only screens and document output', () => {
    for (const ch of ['dashboard/get', 'patients/list', 'patients/get', 'invoices/get', 'reports/run', 'reports/print', 'print/pdf', 'settings/get', 'search/global']) {
      expect(isDemoAllowed(ch), ch).toBe(true);
    }
  });

  it('allows nothing that is not a real channel, and blocks unknown future channels', () => {
    const all = new Set<string>(Object.values(IPC));
    for (const ch of DEMO_ALLOWED_CHANNELS) expect(all.has(ch), ch).toBe(true);
    expect(isDemoAllowed('patients/purge-everything')).toBe(false);
  });

  it('no allow-listed channel name looks like a write', () => {
    for (const ch of DEMO_ALLOWED_CHANNELS) {
      expect(ch, ch).not.toMatch(/\/(create|update|save|delete|remove|void|set|set-auto|set-enabled|restore|reset|reset-business|upload-logo|archive|complete|verify|mark-read|prepare|duplicate)$/);
    }
  });
});

describe('V5-010 print windows require the document read permission', () => {
  it('maps every printable kind to the permissions its data needs', () => {
    expect(printWindowPermissions('invoice')).toEqual(['billing.invoice.view']);
    expect(printWindowPermissions('receipt')).toEqual(['billing.invoice.view', 'billing.payment.view']);
    expect(printWindowPermissions('prescription')).toEqual(['clinical.view']);
    expect(printWindowPermissions('prescription-duplicate')).toEqual(['clinical.view']);
    expect(printWindowPermissions('visit-summary')).toEqual(['clinical.view']);
    expect(printWindowPermissions('appointment-card')).toEqual(['appointments.view']);
    expect(printWindowPermissions('stock-labels')).toEqual(['inventory.view']);
    for (const def of REPORT_DEFS) {
      expect(printWindowPermissions('report', def.name)).toEqual([def.permission]);
      expect(isPermissionKey(def.permission)).toBe(true);
    }
  });

  it('accepts only known kinds; walk-in documents use their own channel', () => {
    for (const kind of PRINTABLE_KINDS) expect(isPrintableKind(kind)).toBe(true);
    expect(isPrintableKind('quick')).toBe(false);
    expect(isPrintableKind('../settings')).toBe(false);
    expect(isPrintableKind(undefined)).toBe(false);
  });
});

describe('V5-004 windows only show the packaged renderer entry', () => {
  const posixEntry = '/opt/dentiva/resources/app.asar/dist/renderer/index.html';
  const winEntry = 'C:\\Users\\Clinic\\AppData\\Local\\Programs\\Dentiva Pro\\resources\\app.asar\\dist\\renderer\\index.html';

  it('allows the entry with any hash or query (POSIX)', () => {
    expect(isAppEntryUrl(`file://${posixEntry}`, posixEntry, 'linux')).toBe(true);
    expect(isAppEntryUrl(`file://${posixEntry}#/patients/12`, posixEntry, 'linux')).toBe(true);
    expect(isAppEntryUrl(`file://${posixEntry}?x=1#print/invoice/3`, posixEntry, 'linux')).toBe(true);
  });

  it('allows the entry on Windows regardless of drive-letter case and escaping', () => {
    const url = 'file:///c:/Users/Clinic/AppData/Local/Programs/Dentiva%20Pro/resources/app.asar/dist/renderer/index.html#/';
    expect(isAppEntryUrl(url, winEntry, 'win32')).toBe(true);
  });

  it('refuses other files, remote pages and script URLs', () => {
    expect(isAppEntryUrl('file:///etc/passwd', posixEntry, 'linux')).toBe(false);
    expect(isAppEntryUrl(`file://${path.posix.dirname(posixEntry)}/other.html`, posixEntry, 'linux')).toBe(false);
    expect(isAppEntryUrl('file:///C:/Users/Clinic/Downloads/evil.html', winEntry, 'win32')).toBe(false);
    expect(isAppEntryUrl('file://attacker-host/share/index.html', posixEntry, 'linux')).toBe(false);
    expect(isAppEntryUrl('https://example.com/', posixEntry, 'linux')).toBe(false);
    expect(isAppEntryUrl('javascript:alert(1)', posixEntry, 'linux')).toBe(false);
    expect(isAppEntryUrl('data:text/html,<p>x</p>', posixEntry, 'linux')).toBe(false);
    expect(isAppEntryUrl('not a url', posixEntry, 'linux')).toBe(false);
  });
});
