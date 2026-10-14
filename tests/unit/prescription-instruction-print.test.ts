/**
 * Print-path contract for the optional single-line medicine instruction.
 *
 * The requirement is explicit: the instruction must print **once**, must not
 * duplicate or conflict with the structured medicine rows, and must not appear
 * at all for the prescriptions that never used it (i.e. every prescription
 * saved before v4.1.3). This test renders the real prescription document with
 * the same sample payload the print window and the settings preview use, and
 * counts what the printer would actually put on the page.
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { prescriptionDoc, rxToDoc } from '../../src/renderer/documents/print-documents';
import { DOCUMENT_SAMPLES } from '../../src/renderer/documents/samples';

const INSTRUCTION = 'Tab.Napa - 100MG - 1+0+1/ or 2 Times -1 Tab - 7 Days - After Meals';

const sample = () => DOCUMENT_SAMPLES.prescription();

/** The sample prescription with the instruction replaced by `value`. */
function renderWith(value: string | null | undefined, patch: (data: any) => any = (d) => d): string {
  const data = sample();
  return renderToStaticMarkup(createElement(prescriptionDoc, patch({
    ...data,
    rx: { ...data.rx, medicineInstruction: value },
  })));
}

const occurrences = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

describe('single-line medicine instruction in the printed prescription', () => {
  it('prints the typed line exactly once, under its own label', () => {
    const html = renderWith(INSTRUCTION);
    expect(occurrences(html, INSTRUCTION)).toBe(1);
    expect(html).toContain('prescription-medicine-instruction');
    expect(html).toContain('Medicine Instruction');
    // The customization markers are present so a clinic can restyle the line.
    expect(html).toContain('data-doc-el="prescription.body.medicineInstructionLabel"');
    expect(html).toContain('data-doc-el="prescription.body.medicineInstructionValue"');
  });

  it('leaves the document untouched when the doctor used the structured rows only', () => {
    for (const empty of ['', '   ', null, undefined]) {
      const html = renderWith(empty as string);
      expect(html, String(empty)).not.toContain('prescription-medicine-instruction');
      expect(html, String(empty)).not.toContain('prescription.body.medicineInstruction');
    }
  });

  it('does not repeat, reshape or relocate the structured medicines', () => {
    // Both forms filled: the structured rows keep their own place and values and
    // the free-text line is an additional block — nothing is merged.
    const withText = renderWith(INSTRUCTION);
    const withoutText = renderWith('');
    for (const medicine of ['Amoxicillin', 'Ibuprofen', '500mg', 'after meals']) {
      expect(occurrences(withText, medicine), medicine).toBe(occurrences(withoutText, medicine));
    }
    expect(withText.indexOf('Amoxicillin')).toBe(withoutText.indexOf('Amoxicillin'));
    // The instruction block sits after the medicine table and before the advice.
    expect(withText.indexOf('prescription-medicine-instruction')).toBeGreaterThan(withText.indexOf('Amoxicillin'));
    expect(withText.indexOf('prescription-medicine-instruction')).toBeLessThan(withText.indexOf('prescription-advice'));
  });

  it('honours a clinic-renamed label and falls back to the default', () => {
    const renamed = renderWith(INSTRUCTION, (data) => ({
      ...data,
      settings: { ...data.settings, prescription: { ...data.settings.prescription, labels: { medicineInstruction: 'Rx line' } } },
    }));
    expect(renamed).toContain('Rx line');
    expect(renamed).not.toContain('Medicine Instruction');
  });

  it('carries the stored value through rxToDoc unchanged', () => {
    const data = sample();
    expect(rxToDoc({ ...data.rx, medicineInstruction: INSTRUCTION }).medicineInstruction).toBe(INSTRUCTION);
    // A legacy row (no column value) maps to null, which renders nothing.
    expect(rxToDoc({ ...data.rx, medicineInstruction: undefined }).medicineInstruction).toBeNull();
  });
});
