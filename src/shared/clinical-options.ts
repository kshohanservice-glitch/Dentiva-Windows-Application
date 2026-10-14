/**
 * Common structured C/C and O/E choices used by the registered-patient and
 * walk-in prescription forms. Values deliberately match the long-standing
 * Main Prescription values so existing saved templates and printed records
 * remain compatible; arbitrary findings remain available through “Other”.
 */
export const CHIEF_COMPLAINT_OPTIONS = [
  { value: 'Pain On', label: 'Pain On' },
  { value: 'G. Carries', label: 'G. Carries' },
  { value: 'Swelling', label: 'Swelling' },
  { value: 'Gum Bleeding', label: 'Gum Bleeding' },
  { value: 'Bad Breath', label: 'Bad Breath' },
  { value: 'Sensitivity', label: 'Sensitivity' },
  { value: 'Other', label: 'Other' },
] as const;

export const EXAMINATION_OPTIONS = [
  { value: 'Carries/G.Carries', label: 'Carries/G.Carries' },
  { value: 'BDR/BDC', label: 'BDR/BDC' },
  { value: 'Gingivitis', label: 'Gingivitis' },
  { value: 'Parodental Pocket', label: 'Parodental Pocket' },
  { value: 'Perio Dontitis', label: 'Perio Dontitis' },
  { value: 'Plupitis', label: 'Plupitis' },
  { value: 'Impected Teeth', label: 'Impected Teeth' },
  { value: 'Dry Socket', label: 'Dry Socket' },
  { value: 'Attrition/Errosion', label: 'Attrition/Errosion' },
  { value: 'Other', label: 'Other' },
] as const;

/** A typed template may contain either a known choice or a clinician's own text. */
export function clinicalChoice(value: string | null | undefined, options: readonly { value: string }[]): {
  choice: string;
  other: string;
} {
  const text = value?.trim() ?? '';
  if (!text) return { choice: '', other: '' };
  if (options.some((option) => option.value === text)) return { choice: text, other: '' };
  return { choice: 'Other', other: text };
}
