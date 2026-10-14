import { describe, expect, it } from 'vitest';
import { CHIEF_COMPLAINT_OPTIONS, EXAMINATION_OPTIONS, clinicalChoice } from '../../src/shared/clinical-options';
import { hasMedicineDraftContent } from '../../src/shared/clinical-templates';

describe('prescription clinical choices', () => {
  it('offers C/C and O/E choices with explicit manual-entry support', () => {
    expect(CHIEF_COMPLAINT_OPTIONS.some((option) => option.value === 'Other')).toBe(true);
    expect(EXAMINATION_OPTIONS.some((option) => option.value === 'Other')).toBe(true);
    expect(clinicalChoice('Pain On', CHIEF_COMPLAINT_OPTIONS)).toEqual({ choice: 'Pain On', other: '' });
    expect(clinicalChoice('Patient-specific note', CHIEF_COMPLAINT_OPTIONS)).toEqual({ choice: 'Other', other: 'Patient-specific note' });
  });

  it('treats one-line medicine instructions as draft content before template replacement', () => {
    expect(hasMedicineDraftContent([{ medicineName: '', medicineInstruction: '' }])).toBe(false);
    expect(hasMedicineDraftContent([{ medicineName: '', medicineInstruction: 'Take as directed by the dentist.' }])).toBe(true);
  });
});

describe('clinical choice list integrity', () => {
  const lists = [
    { name: 'C/C', options: CHIEF_COMPLAINT_OPTIONS, expected: [
      'Pain On', 'G. Carries', 'Swelling', 'Gum Bleeding', 'Bad Breath', 'Sensitivity',
    ] },
    { name: 'O/E', options: EXAMINATION_OPTIONS, expected: [
      'Carries/G.Carries', 'BDR/BDC', 'Gingivitis', 'Parodental Pocket', 'Perio Dontitis',
      'Plupitis', 'Impected Teeth', 'Dry Socket', 'Attrition/Errosion',
    ] },
  ];

  it('keeps exactly the long-standing entries and one Other escape hatch', () => {
    // These strings are what clinicians have been picking and what historic
    // prescriptions already hold; a rename would silently fork the data.
    for (const list of lists) {
      expect(list.options.map((option) => option.value), list.name).toEqual([...list.expected, 'Other']);
    }
  });

  it('has unique values, non-empty labels, and no hidden duplicates of Other', () => {
    for (const list of lists) {
      const values = list.options.map((option) => option.value);
      expect(new Set(values).size, `${list.name} has duplicate values`).toBe(values.length);
      for (const option of list.options) {
        expect(option.label.trim(), `${list.name}/${option.value} label`).not.toBe('');
      }
      expect(values.filter((value) => value === 'Other'), list.name).toHaveLength(1);
      expect(values[values.length - 1], `${list.name} puts Other last`).toBe('Other');
    }
  });

  it('decodes every stored value back to itself, and anything else to Other', () => {
    for (const list of lists) {
      for (const option of list.options) {
        if (option.value === 'Other') continue;
        expect(clinicalChoice(option.value, list.options), `${list.name}/${option.value}`)
          .toEqual({ choice: option.value, other: '' });
      }
    }
    expect(clinicalChoice('  Pain On  ', CHIEF_COMPLAINT_OPTIONS)).toEqual({ choice: 'Pain On', other: '' });
    expect(clinicalChoice('', CHIEF_COMPLAINT_OPTIONS)).toEqual({ choice: '', other: '' });
    expect(clinicalChoice(null, CHIEF_COMPLAINT_OPTIONS)).toEqual({ choice: '', other: '' });
    expect(clinicalChoice(undefined, EXAMINATION_OPTIONS)).toEqual({ choice: '', other: '' });
    expect(clinicalChoice('   ', EXAMINATION_OPTIONS)).toEqual({ choice: '', other: '' });
    // Free text never becomes a list value, and never loses its words.
    expect(clinicalChoice('Fractured crown 46', EXAMINATION_OPTIONS))
      .toEqual({ choice: 'Other', other: 'Fractured crown 46' });
    expect(clinicalChoice('Other', CHIEF_COMPLAINT_OPTIONS)).toEqual({ choice: 'Other', other: '' });
  });
});
