import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * UI-language gate for the WhatsApp feature: every new control label must be
 * English. Bengali is allowed only as patient-message content (template
 * bodies in src/shared/whatsapp.ts, covered by whatsapp.test.ts) — the new
 * renderer components therefore contain no Bengali literals at all; Bengali
 * reaches the screen only as data inside the message preview/editor.
 */
const BENGALI = /[\u0980-\u09FF]/;

function read(rel: string): string {
  return fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
}

describe('WhatsApp UI language', () => {
  it('new renderer components contain no Bengali UI literals', () => {
    for (const file of ['src/renderer/components/whatsapp-hub.tsx', 'src/renderer/components/message-templates.tsx']) {
      expect(BENGALI.test(read(file)), file).toBe(false);
    }
  });

  it('patient form and profile expose the required English WhatsApp labels', () => {
    const patients = read('src/renderer/pages/Patients.tsx');
    for (const label of ['WhatsApp Number', 'Same as Phone Number', 'Validate Number', 'WhatsApp & Documents']) {
      expect(patients).toContain(label);
    }
    const hub = read('src/renderer/components/whatsapp-hub.tsx');
    for (const label of [
      'Open WhatsApp Chat', 'Send Reminder', 'Send Follow-up Reminder', 'Send Custom Message',
      'Share PDF', 'View Message History', 'Edit WhatsApp Number', 'Message Preview',
      'Refresh Documents', 'Printable Documents',
    ]) {
      expect(hub).toContain(label);
    }
    const settings = read('src/renderer/pages/Settings.tsx');
    expect(settings).toContain('Message Templates');
    expect(read('src/renderer/components/message-templates.tsx')).toContain('Time-based greeting');
  });
});
