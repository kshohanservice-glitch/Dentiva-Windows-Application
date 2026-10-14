/** Clinical reference data shared by main (docs, validation) and renderer (UI). */

export interface ConditionDef { key: string; label: string; color: string; glyph: string; group: 'caries' | 'restoration' | 'missing' | 'endodontic' | 'prosthetic' | 'surgical' | 'periodontal' | 'other' }

export const TOOTH_CONDITIONS: ConditionDef[] = [
  { key: 'caries', label: 'Caries', color: '#B42318', glyph: 'C', group: 'caries' },
  { key: 'restored', label: 'Restoration', color: '#175CD3', glyph: 'R', group: 'restoration' },
  { key: 'missing', label: 'Missing', color: '#475467', glyph: 'X', group: 'missing' },
  { key: 'root_canal', label: 'Root canal treated', color: '#7A5AF8', glyph: 'RCT', group: 'endodontic' },
  { key: 'crown', label: 'Crown', color: '#0E7C86', glyph: 'Cr', group: 'prosthetic' },
  { key: 'bridge', label: 'Bridge', color: '#084B63', glyph: 'Br', group: 'prosthetic' },
  { key: 'implant', label: 'Implant', color: '#344054', glyph: 'Im', group: 'prosthetic' },
  { key: 'fracture', label: 'Fracture', color: '#DC6803', glyph: 'F', group: 'other' },
  { key: 'extraction_needed', label: 'Extraction indicated', color: '#D92D20', glyph: 'EX', group: 'surgical' },
  { key: 'abscess', label: 'Abscess / infection', color: '#912018', glyph: 'A', group: 'other' },
  { key: 'periodontal', label: 'Periodontal involvement', color: '#1E7A4B', glyph: 'P', group: 'periodontal' },
  { key: 'mobility', label: 'Mobility', color: '#B26B00', glyph: 'M', group: 'periodontal' },
];

export const CONDITION_KEYS = TOOTH_CONDITIONS.map((c) => c.key);

export function conditionLabel(key: string): string {
  return TOOTH_CONDITIONS.find((c) => c.key === key)?.label ?? key;
}

/** FDI numbering: adult (permanent) + pediatric (primary) dentition. */
export const ADULT_TEETH: string[] = [
  '18', '17', '16', '15', '14', '13', '12', '11',
  '21', '22', '23', '24', '25', '26', '27', '28',
  '48', '47', '46', '45', '44', '43', '42', '41',
  '31', '32', '33', '34', '35', '36', '37', '38',
];

export const PEDIATRIC_TEETH: string[] = [
  '55', '54', '53', '52', '51',
  '61', '62', '63', '64', '65',
  '85', '84', '83', '82', '81',
  '71', '72', '73', '74', '75',
];

export function isPediatricTooth(code: string): boolean {
  return code.startsWith('5') || code.startsWith('6') || code.startsWith('7') || code.startsWith('8') && code.length === 2 && Number(code[0]) >= 5;
}

export function toothDentition(code: string): 'adult' | 'pediatric' {
  const q = Number(code[0]);
  return q >= 5 ? 'pediatric' : 'adult';
}

export function toothArch(code: string): 'upper' | 'lower' {
  const q = Number(code[0]);
  if (q === 1 || q === 2 || q === 5 || q === 6) return 'upper';
  return 'lower';
}

export const GENDERS = ['male', 'female', 'other'] as const;
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;

export const MEDICINE_FORMS = ['tablet', 'capsule', 'syrup', 'suspension', 'drops', 'gel', 'cream', 'ointment', 'mouthwash', 'injection', 'other'] as const;
export const FREQUENCIES = ['once daily', 'twice daily', 'thrice daily', 'four times daily', 'every 6 hours', 'every 8 hours', 'every 12 hours', 'at bedtime', 'as directed', 'PRN'] as const;

/**
 * "Dosage form" choices offered in the medicine row. The clinical value is the
 * short word the prescription prints (e.g. `Tab`), so it stays terse on paper
 * while the dropdown shows the full word to the operator.
 */
export const DOSAGE_FORM_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Not specified' },
  { value: 'Tab', label: 'Tab — tablet' },
  { value: 'Cap', label: 'Cap — capsule' },
  { value: 'Syr', label: 'Syr — syrup' },
  { value: 'Susp', label: 'Susp — suspension' },
  { value: 'Drops', label: 'Drops' },
  { value: 'Gel', label: 'Gel' },
  { value: 'Cream', label: 'Cream' },
  { value: 'Oint', label: 'Oint — ointment' },
  { value: 'Mouthwash', label: 'Mouthwash' },
  { value: 'Inj', label: 'Inj — injection' },
  { value: 'Other', label: 'Other (type it in the Strength/notes field)' },
];

/** Suggestions for the free-text frequency field (typing anything else is allowed). */
export const FREQUENCY_SUGGESTIONS = [
  '1+0+1', '1+1+1', '1+0+0', '0+0+1', '2+2+2', '1+1+1+1',
  'twice daily', 'thrice daily', 'every 8 hours', 'at bedtime', 'as needed',
];

/* -------------------------- Clinical note options ------------------------- */

/**
 * Chief-complaint (C/C) choices shared by Main Prescription and Walk-in
 * Prescription.
 *
 * The `value` is what is stored in `prescriptions.c_c` and what the printed
 * document shows, so the existing values are preserved verbatim — a
 * prescription written before this list existed still prints exactly as it did.
 * The `label` is what the operator sees, so an abbreviation or a misspelling in
 * a stored value is explained instead of guessed, and `hint` adds the medical
 * meaning where the value alone is ambiguous.
 */
export interface ClinicalOption { value: string; label: string; hint?: string }

/** Sentinel value that reveals the free-text field in both prescription forms. */
export const CLINICAL_OTHER_VALUE = 'Other';

export const CHIEF_COMPLAINT_OPTIONS: ClinicalOption[] = [
  { value: 'Pain On', label: 'Pain on', hint: 'toothache / pain in a tooth' },
  { value: 'G. Carries', label: 'G. Carries', hint: 'gross caries — a visible cavity' },
  { value: 'Swelling', label: 'Swelling', hint: 'facial or gum swelling' },
  { value: 'Gum Bleeding', label: 'Gum bleeding', hint: 'bleeding while brushing or eating' },
  { value: 'Bad Breath', label: 'Bad breath', hint: 'halitosis' },
  { value: 'Sensitivity', label: 'Sensitivity', hint: 'hot / cold / sweet sensitivity' },
  { value: 'Broken Tooth', label: 'Broken tooth', hint: 'fractured or chipped tooth' },
  { value: CLINICAL_OTHER_VALUE, label: 'Other — type it myself' },
];

export const EXAMINATION_OPTIONS: ClinicalOption[] = [
  { value: 'Carries/G.Carries', label: 'Carries / G. Carries', hint: 'caries (cavity) found on examination' },
  { value: 'BDR/BDC', label: 'BDR / BDC', hint: 'by dental report / by dental chart' },
  { value: 'Gingivitis', label: 'Gingivitis', hint: 'inflamed gums' },
  { value: 'Parodental Pocket', label: 'Parodental pocket', hint: 'periodontal pocket' },
  { value: 'Perio Dontitis', label: 'Perio dontitis', hint: 'periodontitis' },
  { value: 'Plupitis', label: 'Plupitis', hint: 'pulpitis — inflamed pulp' },
  { value: 'Impected Teeth', label: 'Impected teeth', hint: 'impacted tooth' },
  { value: 'Dry Socket', label: 'Dry socket', hint: 'alveolar osteitis after extraction' },
  { value: 'Attrition/Errosion', label: 'Attrition / Errosion', hint: 'tooth wear' },
  { value: CLINICAL_OTHER_VALUE, label: 'Other — type it myself' },
];

/* ------------------------ Medicine instruction line ----------------------- */

/* ------------------------- Prescription form labels ----------------------- */

/**
 * Printed labels of the prescription document. A clinic may rename any of them
 * in Settings → Prescription; every label falls back to the value below when it
 * was never configured, so an installation that upgrades keeps printing the same
 * words (`C/C`, `O/E`, …) instead of an empty line.
 */
export interface PrescriptionLabels {
  cc: string; oe: string; re: string; diagnosis: string;
  treatment: string; advice: string; followUp: string; medicineInstruction: string;
}

export const PRESCRIPTION_LABEL_DEFAULTS: PrescriptionLabels = {
  cc: 'C/C',
  oe: 'O/E',
  re: 'R/E',
  diagnosis: 'Diagnosis',
  treatment: 'Treatment',
  advice: 'Advice',
  followUp: 'Follow-up',
  medicineInstruction: 'Medicine Instruction',
};

export const PRESCRIPTION_LABEL_KEYS: (keyof PrescriptionLabels)[] = [
  'cc', 'oe', 're', 'diagnosis', 'treatment', 'advice', 'followUp', 'medicineInstruction',
];

/**
 * Fill in every label, keeping any configured value. Legacy installations stored
 * only the seven original labels, so the eighth (and any future one) is added
 * with its default instead of arriving as an empty field in the settings form or
 * as a blank label on the printed prescription.
 */
export function normalizePrescriptionLabels(raw: unknown): PrescriptionLabels {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = { ...PRESCRIPTION_LABEL_DEFAULTS };
  for (const key of PRESCRIPTION_LABEL_KEYS) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) out[key] = value.trim().slice(0, 60);
  }
  return out;
}

/**
 * Upper bound for one free-text medicine instruction ("Tab.Napa - 100MG -
 * 1+0+1 - 7 days - after meals"). The bound is generous on purpose: the field is
 * free text and must not reject a legitimate instruction, while a stored value
 * still has to be bounded.
 */
export const MEDICINE_INSTRUCTION_MAX = 500;

/** Example shown as helper text — illustrative only, never inserted as a value. */
export const MEDICINE_INSTRUCTION_EXAMPLE = 'Tab.Napa - 100MG - 1+0+1 - 7 days - after meals';

/**
 * Normalize operator input for the optional single-line instruction: trim the
 * ends, drop nothing else (an instruction may legitimately contain `+ / . -`
 * and any script), and bound the length. Returns `null` for an empty value.
 * Never throws, so it is safe on both the form and stored data.
 */
export function normalizeMedicineInstruction(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MEDICINE_INSTRUCTION_MAX);
}

export interface MedicineInstructionState {
  /** At least one structured medicine row has a name. */
  hasStructured: boolean;
  /** The optional single-line instruction has text. */
  hasFreeText: boolean;
  /** Both are filled: both will print, so the operator must be told. */
  both: boolean;
}

/**
 * Deterministic output rule for structured rows versus the optional single-line
 * instruction:
 *
 *   - structured rows print through the existing medicine list, unchanged;
 *   - the single-line instruction prints as its own labelled block underneath;
 *   - nothing is merged, reordered, deduplicated or discarded;
 *   - when both are present the form warns that both will appear, so the
 *     doctor — not the software — decides whether that is what they want.
 */
export function medicineInstructionState(input: {
  items?: { medicineName?: string | null }[];
  instruction?: string | null;
}): MedicineInstructionState {
  const hasStructured = (input.items ?? []).some((item) => !!String(item?.medicineName ?? '').trim());
  const hasFreeText = !!normalizeMedicineInstruction(input.instruction);
  return { hasStructured, hasFreeText, both: hasStructured && hasFreeText };
}
