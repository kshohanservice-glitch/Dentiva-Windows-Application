/**
 * WhatsApp open / copy-link IPC — the path that produced the reported
 * "Could not open WhatsApp — An unexpected error occurred. Please try again."
 *
 * Electron is mocked, so these tests prove (without a desktop session) exactly
 * which URL is handed to the operating system, how an operating-system refusal
 * is turned into a user-facing message, and that the clipboard recovery path
 * only ever carries a validated https://wa.me link.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { handlers, openExternal, writeText, readText } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, payload: unknown) => Promise<any>>(),
  openExternal: vi.fn(),
  writeText: vi.fn(),
  readText: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: (event: unknown, payload: unknown) => Promise<any>) => handlers.set(channel, fn) },
  shell: { openExternal: (url: string) => openExternal(url), openPath: vi.fn() },
  clipboard: { writeText: (text: string) => writeText(text), readText: () => readText() },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: vi.fn() },
  app: { getPath: () => '/tmp', getAppPath: () => '/tmp' },
}));

import { registerRouter } from '../../src/main/ipc/router';
import { setDb } from '../../src/main/app';
import { cleanupEnv, createTestEnv, makePaths, ownerCtx, ownerSession, sessionWith, type TestEnv } from '../helpers';
import { createPatient } from '../../src/main/services/patients';
import { prepareWhatsAppMessage } from '../../src/main/services/whatsapp';
import { buildWhatsAppUrl, MAX_WHATSAPP_LINK_LENGTH, MAX_WHATSAPP_MESSAGE_LENGTH } from '../../src/shared/whatsapp';

const OPEN = 'whatsapp/open';
const COPY = 'whatsapp/copy-link';
const OS_REFUSAL = 'Failed to open: No application is associated with the specified file for this operation.';

let env: TestEnv;
let session = ownerSession();

beforeEach(() => {
  openExternal.mockReset().mockResolvedValue(undefined);
  readText.mockReset().mockReturnValue('');
  // Default behaviour of a healthy clipboard: the read-back returns what was written.
  writeText.mockReset().mockImplementation((text: string) => { readText.mockReturnValue(text); });
  handlers.clear();
  session = ownerSession();
  env = createTestEnv('whatsapp-open');
  setDb(env.db);
  registerRouter({
    paths: () => makePaths(env.dir),
    session: { require: () => session } as any,
    activation: {} as any,
    backup: {} as any,
    securityPolicy: () => ({ maxFailedLogins: 5, minPasswordLength: 8 }),
    appVersion: '4.1.0',
    schemaVersion: () => 6,
    refreshNotifications: () => undefined,
    demo: false,
  });
});

function seedPatient(consent: 'granted' | 'unknown' | 'declined' = 'granted') {
  return createPatient(ownerCtx(env), {
    name: 'Rahima Akter', gender: 'female', ageYears: 32, phone: '01712345678',
    whatsappNumber: '01712345678', whatsappConsent: consent,
  } as any);
}

const call = (channel: string, payload: unknown) => handlers.get(channel)!(undefined, payload);

describe('whatsapp/open hands a prepared link to the operating system', () => {
  it('passes exactly the https://wa.me link the app prepared, with no WhatsApp Desktop requirement', async () => {
    const patient = seedPatient();
    const prepared = prepareWhatsAppMessage(ownerCtx(env), { patientId: patient.id, category: 'custom', dryRun: true });

    const res = await call(OPEN, prepared.url);

    expect(res).toEqual({ ok: true, data: { ok: true } });
    expect(openExternal).toHaveBeenCalledTimes(1);
    const opened = openExternal.mock.calls[0][0] as string;
    expect(opened).toBe(prepared.url);
    expect(opened.startsWith('https://wa.me/8801712345678?text=')).toBe(true);
    // Never a custom scheme that would require WhatsApp Desktop.
    expect(opened.startsWith('whatsapp://')).toBe(false);
  });

  it('turns an operating-system refusal into an actionable message instead of the generic internal error', async () => {
    openExternal.mockRejectedValue(new Error(OS_REFUSAL));
    const url = buildWhatsAppUrl('8801712345678', 'hello');

    const res = await call(OPEN, url);

    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('FILE');
    // The reported symptom was this exact generic text.
    expect(res.error.message).not.toContain('An unexpected error occurred');
    expect(res.error.message).toMatch(/default browser/i);
    expect(res.error.message).toContain('Copy link');
    // No internal/OS text reaches the doctor, but a correlation id is provided.
    expect(res.error.message).not.toContain('Failed to open');
    expect(res.error.message).not.toContain('ShellExecute');
    expect(typeof res.error.correlationId).toBe('string');
  });

  it('refuses to open anything that is not a validated https wa.me link', async () => {
    for (const bad of [
      'javascript:alert(1)',
      'http://wa.me/8801712345678',
      'https://wa.me.evil.example/8801712345678',
      'https://evil.example/8801712345678',
      'file:///C:/Windows/System32/calc.exe',
      'whatsapp://send?phone=8801712345678',
      { url: 'https://wa.me/8801712345678' },
      '',
      null,
    ]) {
      const res = await call(OPEN, bad);
      expect(res.ok, JSON.stringify(bad)).toBe(false);
      expect(res.error.code).toBe('VALIDATION');
    }
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('still refuses a link longer than the app can legitimately produce', async () => {
    const res = await call(OPEN, buildWhatsAppUrl('8801712345678', 'ক'.repeat(MAX_WHATSAPP_MESSAGE_LENGTH * 2)));
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('VALIDATION');
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('accepts the longest Bengali reminder the app itself allows', async () => {
    const message = 'ক'.repeat(MAX_WHATSAPP_MESSAGE_LENGTH);
    const url = buildWhatsAppUrl('8801712345678', message);
    expect(url.length).toBeLessThanOrEqual(MAX_WHATSAPP_LINK_LENGTH);

    const res = await call(OPEN, url);

    expect(res.ok).toBe(true);
    expect(openExternal).toHaveBeenCalledWith(url);
  });

  it('requires the existing patients.view permission', async () => {
    session = sessionWith([]);
    const url = buildWhatsAppUrl('8801712345678', 'hello');
    const res = await call(OPEN, url);
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('PERMISSION');
    expect(openExternal).not.toHaveBeenCalled();
  });
});

describe('whatsapp/copy-link recovery path', () => {
  it('copies the same validated link so the doctor can paste it manually', async () => {
    const url = buildWhatsAppUrl('8801712345678', 'শুভ সকাল');
    const res = await call(COPY, url);
    expect(res).toEqual({ ok: true, data: { ok: true } });
    expect(writeText).toHaveBeenCalledWith(url);
  });

  it('never reports success when the clipboard write itself fails', async () => {
    writeText.mockImplementation(() => { throw new Error('clipboard locked by another application'); });
    const res = await call(COPY, buildWhatsAppUrl('8801712345678', 'hello'));

    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('FILE');
    expect(res.error.message).toMatch(/Could not copy the WhatsApp link/i);
    expect(res.error.message).toMatch(/clipboard/i);
    // The raw clipboard error and the generic internal text stay out of the UI.
    expect(res.error.message).not.toContain('An unexpected error occurred');
    expect(res.error.message).not.toContain('locked by another application');
    expect(typeof res.error.correlationId).toBe('string');
  });

  it('detects a silently dropped write when the clipboard still holds different text', async () => {
    // Windows keeps the previous clipboard contents when a write silently fails.
    writeText.mockImplementation(() => undefined);
    readText.mockReturnValue('something the doctor copied earlier');
    const res = await call(COPY, buildWhatsAppUrl('8801712345678', 'hello'));

    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('FILE');
    expect(res.error.message).toMatch(/Could not copy the WhatsApp link/i);
    // Neither the stale clipboard text nor the link itself is echoed back.
    expect(res.error.message).not.toContain('something the doctor copied earlier');
    expect(res.error.message).not.toContain('wa.me');
  });

  it('accepts the copy when the read-back is unavailable, without claiming more than it can', async () => {
    // Documented limitation: a clipboard that cannot be read back (or is empty)
    // cannot be verified, so the successful write call is accepted.
    writeText.mockImplementation(() => undefined);
    readText.mockImplementation(() => { throw new Error('clipboard unavailable'); });
    expect(await call(COPY, buildWhatsAppUrl('8801712345678', 'a'))).toEqual({ ok: true, data: { ok: true } });

    readText.mockReturnValue('');
    expect(await call(COPY, buildWhatsAppUrl('8801712345678', 'b'))).toEqual({ ok: true, data: { ok: true } });
  });

  it('never copies anything but a validated https wa.me link', async () => {
    for (const bad of ['javascript:alert(1)', 'https://evil.example/x', 'file:///etc/passwd', 'https://wa.me/12']) {
      const res = await call(COPY, bad);
      expect(res.ok, bad).toBe(false);
      expect(res.error.code).toBe('VALIDATION');
    }
    expect(writeText).not.toHaveBeenCalled();
  });

  it('requires the existing patients.view permission', async () => {
    session = sessionWith([]);
    const res = await call(COPY, buildWhatsAppUrl('8801712345678', 'hello'));
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('PERMISSION');
    expect(writeText).not.toHaveBeenCalled();
  });
});

afterEach(() => {
  cleanupEnv(env);
});
