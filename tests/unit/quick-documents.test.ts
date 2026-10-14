/**
 * Feature B unit tests — the walk-in / quick-document model.
 *
 * Two things are being protected:
 *   1. a quick document is bounded and validated before it can reach a
 *      renderer (it is the only input the main process accepts for this path);
 *   2. a quick document can never be confused with a stored document — no
 *      patient id, no invoice number, and no WhatsApp surface anywhere.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  QUICK_DOCUMENT_DEFS, QUICK_DOCUMENT_KINDS, quickDocumentFileName, quickDocumentReference,
  validateQuickDocumentInput,
} from '../../src/shared/quick-documents';
import { ALL_PERMISSIONS } from '../../src/shared/permissions';
import { MEDICINE_INSTRUCTION_MAX } from '../../src/shared/clinical';

const repoRoot = path.resolve(__dirname, '..', '..');
const read = (rel: string): string => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const customer = { name: 'Walk-in Customer', phone: '01711111111', ageYears: 30, gender: 'Male' };

describe('quick document definitions', () => {
  it('offers every document that can be produced without a patient record', () => {
    expect(QUICK_DOCUMENT_KINDS).toEqual(['prescription', 'invoice', 'receipt', 'visit-summary', 'appointment-card']);
  });

  it('uses real permissions from the catalog', () => {
    for (const kind of QUICK_DOCUMENT_KINDS) {
      const def = QUICK_DOCUMENT_DEFS[kind];
      expect(ALL_PERMISSIONS).toContain(def.permission);
      expect(ALL_PERMISSIONS).toContain(def.printPermission);
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.limitation.length).toBeGreaterThan(20);
    }
  });

  it('marks every kind with a reference prefix that cannot collide with the invoice series', () => {
    for (const kind of QUICK_DOCUMENT_KINDS) {
      const prefix = QUICK_DOCUMENT_DEFS[kind].referencePrefix;
      expect(prefix).toMatch(/^Q[A-Z]$/);
      expect(prefix).not.toBe('INV');
      expect(quickDocumentReference(kind, new Date('2026-10-14T09:05:07'))).toBe(`${prefix}-20261014-090507`);
      expect(quickDocumentReference(kind, new Date('2026-10-14T09:05:07'))).not.toMatch(/^INV-\d{4}-\d{5}$/);
    }
  });

  it('builds a sanitized, clearly-marked PDF file name', () => {
    const payload = validateQuickDocumentInput({
      kind: 'invoice',
      payload: { reference: 'QI-20261014-090507', date: '2026-10-14', customer, lines: [{ description: 'Cleaning', qty: 1, unitPricePaisa: 100000 }] },
    }).input!;
    const name = quickDocumentFileName('invoice', payload.payload);
    expect(name).toContain('QI-');
    expect(name).toMatch(/^[A-Za-z0-9-_ ]+$/);
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
  });
});

describe('validateQuickDocumentInput', () => {
  it('rejects an unknown document type', () => {
    expect(validateQuickDocumentInput({ kind: 'statement', payload: {} }).input).toBeNull();
    expect(validateQuickDocumentInput(null).errors[0]).toBe('Unknown quick document type.');
  });

  it('requires a customer name and a date', () => {
    const result = validateQuickDocumentInput({ kind: 'receipt', payload: { reference: 'QR-1', date: 'nope', customer: { name: '' }, amountPaisa: 100 } });
    expect(result.input).toBeNull();
    expect(result.errors).toEqual(expect.arrayContaining(['Customer name is required.', 'Date must be a date.']));
  });

  it('accepts a complete prescription and trims its text', () => {
    const result = validateQuickDocumentInput({
      kind: 'prescription',
      payload: {
        reference: 'QP-20261014-090507',
        date: '2026-10-14',
        customer: { ...customer, name: '  Walk-in Customer  ' },
        dentistName: 'Dr. Ayesha Rahman',
        advice: '  Soft diet  ',
        items: [{ medicineName: 'Amoxicillin', strength: '500mg' }, { medicineName: 'Ibuprofen' }],
      },
    });
    expect(result.errors).toEqual([]);
    expect(result.input).not.toBeNull();
    expect(result.input!.payload.customer.name).toBe('Walk-in Customer');
    expect((result.input!.payload as any).advice).toBe('Soft diet');
    expect((result.input!.payload as any).items).toHaveLength(2);
  });

  it('carries the optional single-line medicine instruction with the same bound as stored prescriptions', () => {
    const line = 'Tab.Napa - 100MG - 1+0+1 - 7 days - after meals';
    const withLine = validateQuickDocumentInput({
      kind: 'prescription',
      payload: {
        reference: 'QP-1', date: '2026-10-14', customer, dentistName: 'Dr X',
        medicineInstruction: `  ${line}  `,
        items: [{ medicineName: 'Amoxicillin' }],
      },
    });
    expect(withLine.errors).toEqual([]);
    expect((withLine.input!.payload as any).medicineInstruction).toBe(line);

    // Omitted entirely (every walk-in prescription written before v4.1.3).
    const omitted = validateQuickDocumentInput({
      kind: 'prescription',
      payload: { reference: 'QP-1', date: '2026-10-14', customer, dentistName: 'Dr X', items: [{ medicineName: 'A' }] },
    });
    expect((omitted.input!.payload as any).medicineInstruction).toBeNull();

    // Over-long instructions are rejected, not silently truncated.
    const oversized = validateQuickDocumentInput({
      kind: 'prescription',
      payload: {
        reference: 'QP-1', date: '2026-10-14', customer, dentistName: 'Dr X',
        medicineInstruction: 'x'.repeat(MEDICINE_INSTRUCTION_MAX + 1),
        items: [{ medicineName: 'A' }],
      },
    });
    expect(oversized.input).toBeNull();
    expect(oversized.errors.some((e) => e.includes(`Medicine instruction must be ${MEDICINE_INSTRUCTION_MAX} characters or fewer.`))).toBe(true);
  });

  it('requires at least one medicine or invoice line', () => {
    const rx = validateQuickDocumentInput({
      kind: 'prescription',
      payload: { reference: 'QP-1', date: '2026-10-14', customer, dentistName: 'Dr X', items: [] },
    });
    expect(rx.input).toBeNull();
    expect(rx.errors).toContain('Add at least one medicine.');

    const invoice = validateQuickDocumentInput({
      kind: 'invoice',
      payload: { reference: 'QI-1', date: '2026-10-14', customer, lines: [] },
    });
    expect(invoice.input).toBeNull();
    expect(invoice.errors).toContain('Add at least one invoice line.');
  });

  it('rejects a line discount larger than the line total', () => {
    const result = validateQuickDocumentInput({
      kind: 'invoice',
      payload: {
        reference: 'QI-1', date: '2026-10-14', customer,
        lines: [{ description: 'Scaling', qty: 1, unitPricePaisa: 50000, discountPaisa: 60000 }],
      },
    });
    expect(result.input).toBeNull();
    expect(result.errors[0]).toContain('discount exceeds the line total');
  });

  it('bounds every collection instead of trusting the form', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ medicineName: `Medicine ${i}` }));
    const result = validateQuickDocumentInput({
      kind: 'prescription',
      payload: { reference: 'QP-1', date: '2026-10-14', customer, dentistName: 'Dr X', items: many },
    });
    expect(result.input).not.toBeNull();
    expect((result.input!.payload as any).items).toHaveLength(60);
  });

  it('bounds string lengths and rejects non-string values', () => {
    const long = 'x'.repeat(5000);
    const result = validateQuickDocumentInput({
      kind: 'receipt',
      payload: { reference: 'QR-1', date: '2026-10-14', customer: { ...customer, name: long }, amountPaisa: 1000, method: 42 },
    });
    expect(result.input).toBeNull();
    expect(result.errors.some((e) => e.includes('Customer name must be 120 characters or fewer.'))).toBe(true);
    expect(result.errors.some((e) => e.includes('Payment method must be text.'))).toBe(true);
  });

  it('validates the appointment time as HH:MM and the amounts as integers', () => {
    const bad = validateQuickDocumentInput({
      kind: 'appointment-card',
      payload: { reference: 'QA-1', date: '2026-10-14', customer, time: '25:99' },
    });
    expect(bad.input).toBeNull();
    expect(bad.errors).toContain('Time must be a valid time.');

    const good = validateQuickDocumentInput({
      kind: 'appointment-card',
      payload: { reference: 'QA-1', date: '2026-10-14', customer, time: '10:30', durationMin: 30 },
    });
    expect(good.input).not.toBeNull();
    expect((good.input!.payload as any).time).toBe('10:30');

    const negative = validateQuickDocumentInput({
      kind: 'receipt',
      payload: { reference: 'QR-1', date: '2026-10-14', customer, amountPaisa: -5 },
    });
    expect(negative.input).toBeNull();
    expect(negative.errors.some((e) => e.includes('Amount received must be between'))).toBe(true);
  });

  it('never throws, whatever the payload looks like', () => {
    const hostile: unknown[] = [null, undefined, 0, 'x', [], { kind: 'invoice' }, { kind: 'invoice', payload: 'nope' },
      { kind: 'invoice', payload: { lines: [{ description: {}, qty: 'abc', unitPricePaisa: NaN }] } },
      { kind: 'prescription', payload: { items: [null, 3, {}] } }];
    for (const value of hostile) {
      expect(() => validateQuickDocumentInput(value)).not.toThrow();
    }
  });

  it('never produces a patient identifier', () => {
    const result = validateQuickDocumentInput({
      kind: 'receipt',
      payload: { reference: 'QR-1', date: '2026-10-14', customer, amountPaisa: 1000, patientId: 7, patientCode: 'P-000123' },
    });
    expect(result.input).not.toBeNull();
    expect(JSON.stringify(result.input)).not.toContain('patientId');
    expect(JSON.stringify(result.input)).not.toContain('P-000123');
  });
});

describe('the walk-in workflow has no WhatsApp surface', () => {
  const files = [
    'src/shared/quick-documents.ts',
    'src/main/services/quick-documents.ts',
    'src/renderer/pages/QuickDocuments.tsx',
    'src/renderer/documents/quick-document-view.tsx',
  ];

  it('contains no WhatsApp reference, link or action', () => {
    // Comments are stripped first: a comment that documents the absence of a
    // feature is not a WhatsApp surface, code is.
    const code = (text: string): string => text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n');
    for (const file of files) {
      const text = code(read(file));
      expect(text, file).not.toMatch(/whatsapp/i);
      expect(text, file).not.toMatch(/wa\.me/i);
      expect(text, file).not.toMatch(/web\.whatsapp/i);
      expect(text, file).not.toMatch(/send\s*message/i);
    }
  });

  it('does not import the WhatsApp hub or the WhatsApp service', () => {
    for (const file of files) {
      expect(read(file), file).not.toMatch(/whatsapp-hub|services\/whatsapp/);
    }
  });

  it('leaves the WhatsApp feature itself installed and reachable', () => {
    // Regression guard for the scope limit: the restriction applies to the
    // walk-in workflow only.
    expect(fs.existsSync(path.join(repoRoot, 'src/renderer/components/whatsapp-hub.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'src/main/services/whatsapp.ts'))).toBe(true);
    // … and the patient screens still mount it.
    expect(read('src/renderer/pages/Patients.tsx')).toContain("import { WhatsAppHub } from '../components/whatsapp-hub'");
  });
});
