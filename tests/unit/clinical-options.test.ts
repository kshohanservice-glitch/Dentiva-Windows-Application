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
