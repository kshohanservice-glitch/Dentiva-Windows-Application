/**
 * Regression tests for the shared clinical reference data introduced with the
 * v4.1.3 form clarifications.
 *
 * The value stored in `prescriptions.c_c` / `prescriptions.o_e` is what the
 * printed document shows, so the option lists must reproduce the historical
 * values **exactly**. These tests freeze that contract: if someone "tidies up"
 * `G. Carries` into `Gross caries`, or drops `Other`, a prescription written
 * before this list existed would print differently or a free-text complaint
 * would become unreachable.
 */
import { describe, expect, it } from 'vitest';
import {
  CHIEF_COMPLAINT_OPTIONS, CLINICAL_OTHER_VALUE, DOSAGE_FORM_OPTIONS, EXAMINATION_OPTIONS,
  FREQUENCY_SUGGESTIONS, MEDICINE_INSTRUCTION_EXAMPLE, MEDICINE_INSTRUCTION_MAX,
  PRESCRIPTION_LABEL_DEFAULTS, PRESCRIPTION_LABEL_KEYS, medicineInstructionState,
  normalizeMedicineInstruction, normalizePrescriptionLabels, type ClinicalOption,
} from '../../src/shared/clinical';

describe('clinical note options (C/C and O/E)', () => {
  const lists: { name: string; options: ClinicalOption[] }[] = [
    { name: 'chief complaint', options: CHIEF_COMPLAINT_OPTIONS },
    { name: 'examination', options: EXAMINATION_OPTIONS },
  ];

  it('offers a free-text escape hatch in both lists', () => {
    for (const { name, options } of lists) {
      expect(options.at(-1)?.value, name).toBe(CLINICAL_OTHER_VALUE);
      expect(options.filter((o) => o.value === CLINICAL_OTHER_VALUE), name).toHaveLength(1);
    }
  });

  it('has no duplicate values, no blank labels and no blank values', () => {
    for (const { name, options } of lists) {
      const values = options.map((o) => o.value);
      expect(new Set(values).size, name).toBe(values.length);
      for (const option of options) {
        expect(option.value.trim(), name).not.toBe('');
        expect(option.label.trim(), name).not.toBe('');
      }
    }
  });

  it('explains every medical abbreviation so the dropdown is self-teaching', () => {
    for (const { name, options } of lists) {
      for (const option of options) {
        if (option.value === CLINICAL_OTHER_VALUE) continue;
        expect(option.hint, `${name}: ${option.value}`).toBeTruthy();
      }
    }
  });

  it('keeps the historical stored values verbatim', () => {
    // Values written by earlier versions of the app; renaming any of them would
    // change what an existing prescription prints.
    const chiefComplaints = CHIEF_COMPLAINT_OPTIONS.map((o) => o.value);
    for (const legacy of ['Pain On', 'G. Carries', 'Swelling', 'Gum Bleeding', 'Bad Breath', 'Sensitivity', 'Broken Tooth']) {
      expect(chiefComplaints, legacy).toContain(legacy);
    }
    const examination = EXAMINATION_OPTIONS.map((o) => o.value);
    for (const legacy of [
      'Carries/G.Carries', 'BDR/BDC', 'Gingivitis', 'Parodental Pocket', 'Perio Dontitis',
      'Plupitis', 'Impected Teeth', 'Dry Socket', 'Attrition/Errosion',
    ]) {
      expect(examination, legacy).toContain(legacy);
    }
  });

  it('offers the printed dosage-form abbreviations plus a free-text option', () => {
    const values = DOSAGE_FORM_OPTIONS.map((o) => o.value);
    for (const short of ['', 'Tab', 'Cap', 'Syr', 'Inj']) expect(values).toContain(short);
    // The last option tells the operator to type a form that has no abbreviation.
    expect(DOSAGE_FORM_OPTIONS.at(-1)?.label).toMatch(/type/i);
    expect(new Set(values).size).toBe(values.length);
  });

  it('suggests the Bangladesh-style 1+0+1 frequencies and keeps them unique', () => {
    expect(FREQUENCY_SUGGESTIONS).toContain('1+0+1');
    expect(FREQUENCY_SUGGESTIONS).toContain('1+1+1');
    expect(new Set(FREQUENCY_SUGGESTIONS).size).toBe(FREQUENCY_SUGGESTIONS.length);
  });
});

describe('optional single-line medicine instruction', () => {
  it('never inserts the documentation example as data', () => {
    // The example is helper text only; it must not be a default anywhere.
    expect(normalizeMedicineInstruction(MEDICINE_INSTRUCTION_EXAMPLE)).toBe(MEDICINE_INSTRUCTION_EXAMPLE);
    expect(normalizeMedicineInstruction('')).toBeNull();
    expect(normalizeMedicineInstruction('   ')).toBeNull();
  });

  it('trims, collapses inner whitespace and returns null for empty input', () => {
    expect(normalizeMedicineInstruction('  Tab.Napa   1+0+1  ')).toBe('Tab.Napa 1+0+1');
    expect(normalizeMedicineInstruction('\n\n')).toBeNull();
    expect(normalizeMedicineInstruction(null)).toBeNull();
    expect(normalizeMedicineInstruction(undefined)).toBeNull();
    expect(normalizeMedicineInstruction(42)).toBeNull();
  });

  it('keeps the characters a real instruction is made of', () => {
    const line = 'Tab.Napa - 100MG - 1+0+1/ or 2 Times -1 Tab - 7 Days - After Meals';
    expect(normalizeMedicineInstruction(line)).toBe(line);
  });

  it(`caps the stored value at ${MEDICINE_INSTRUCTION_MAX} characters`, () => {
    const long = 'x'.repeat(MEDICINE_INSTRUCTION_MAX + 250);
    expect(normalizeMedicineInstruction(long)).toHaveLength(MEDICINE_INSTRUCTION_MAX);
    expect(normalizeMedicineInstruction('a'.repeat(MEDICINE_INSTRUCTION_MAX))).toHaveLength(MEDICINE_INSTRUCTION_MAX);
  });

  it('reports which entry form the doctor used, so both cannot print unnoticed', () => {
    const rows = [{ medicineName: 'Amoxicillin' }, { medicineName: '   ' }];
    expect(medicineInstructionState({ items: rows, instruction: '' }))
      .toEqual({ hasStructured: true, hasFreeText: false, both: false });
    expect(medicineInstructionState({ items: [], instruction: ' Tab.Napa 1+0+1 ' }))
      .toEqual({ hasStructured: false, hasFreeText: true, both: false });
    expect(medicineInstructionState({ items: rows, instruction: 'Tab.Napa 1+0+1' }))
      .toEqual({ hasStructured: true, hasFreeText: true, both: true });
    expect(medicineInstructionState({ items: [], instruction: null }))
      .toEqual({ hasStructured: false, hasFreeText: false, both: false });
    // A row that only has a strength is a drafting leftover, not a medicine.
    expect(medicineInstructionState({ items: [{ medicineName: '' }], instruction: 'x' }))
      .toEqual({ hasStructured: false, hasFreeText: true, both: false });
  });
});

describe('printed prescription labels', () => {
  it('always produces a complete label set', () => {
    const labels = normalizePrescriptionLabels(undefined);
    expect(labels).toEqual(PRESCRIPTION_LABEL_DEFAULTS);
    // Every key is present and non-empty — a missing label would print a blank
    // heading on a real prescription.
    for (const key of PRESCRIPTION_LABEL_KEYS) expect(labels[key].trim()).not.toBe('');
  });

  it('upgrades a legacy row that predates the medicine-instruction label', () => {
    const legacy = {
      cc: 'C/C', oe: 'O/E', re: 'R/E', diagnosis: 'Diagnosis',
      treatment: 'Treatment', advice: 'Advice', followUp: 'Follow-up',
    };
    const labels = normalizePrescriptionLabels(legacy);
    // The seven stored labels survive untouched…
    expect(labels.cc).toBe('C/C');
    // …and the new eighth label arrives with its default instead of `undefined`.
    expect(labels.medicineInstruction).toBe('Medicine Instruction');
  });

  it('keeps a configured value, trims it, and bounds its length', () => {
    const labels = normalizePrescriptionLabels({
      cc: '  Complaint  ',
      advice: 'y'.repeat(120),
      diagnosis: '',
    });
    expect(labels.cc).toBe('Complaint');
    expect(labels.advice).toHaveLength(60);
    // A blank or non-string value falls back to the default instead of printing nothing.
    expect(labels.diagnosis).toBe('Diagnosis');
    expect(normalizePrescriptionLabels({ treatment: 42 }).treatment).toBe('Treatment');
  });

  it('ignores unknown keys so a hand-edited settings row cannot inject one', () => {
    const labels = normalizePrescriptionLabels({ cc: 'Complaint', evil: '<script>' } as Record<string, unknown>);
    expect(Object.keys(labels).sort()).toEqual([...PRESCRIPTION_LABEL_KEYS].sort());
    expect(JSON.stringify(labels)).not.toContain('script');
  });
});
