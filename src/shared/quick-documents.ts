/**
 * Walk-in / Quick Documents — shared model and validation.
 *
 * A quick document is produced for a one-time customer without registering a
 * permanent patient: the form values travel to the print window as a validated,
 * transient payload and are rendered by the *same* document builders used for
 * stored documents (see `src/renderer/documents/print-documents.tsx`), so both
 * workflows print the same template and the same totals.
 *
 * Guarantees encoded here:
 *   - nothing is written to the patient database for a quick document
 *     (the payload never carries a patient id, and no patient row is created),
 *   - a file name / reference for a quick document is clearly marked as a quick
 *     document and can never collide with the numbered invoice series,
 *   - every string and number is bounded before it reaches a renderer,
 *   - there is no WhatsApp surface anywhere in this model.
 */
import type { PermissionKey } from './permissions';

export type QuickDocumentKind = 'prescription' | 'invoice' | 'receipt' | 'visit-summary' | 'appointment-card';

export const QUICK_DOCUMENT_KINDS: QuickDocumentKind[] = ['prescription', 'invoice', 'receipt', 'visit-summary', 'appointment-card'];

export interface QuickDocumentDef {
  kind: QuickDocumentKind;
  label: string;
  shortLabel: string;
  description: string;
  /** Permission required to fill in the form. */
  permission: PermissionKey;
  /** Permission required to print or export the finished document. */
  printPermission: PermissionKey;
  /** Reference prefix — deliberately outside the invoice number series. */
  referencePrefix: string;
  /** Shown in the UI so the operator knows exactly what is (not) recorded. */
  limitation: string;
}

export const QUICK_DOCUMENT_DEFS: Record<QuickDocumentKind, QuickDocumentDef> = {
  prescription: {
    kind: 'prescription',
    label: 'Quick prescription',
    shortLabel: 'Prescription',
    description: 'Prescription for a walk-in patient. Uses the same prescription template and print layout as a stored prescription.',
    permission: 'clinical.prescription.create',
    printPermission: 'clinical.prescription.print',
    referencePrefix: 'QP',
    limitation: 'No patient record is created and nothing is stored in a patient history — save the prescription PDF if the clinic needs a copy.',
  },
  invoice: {
    kind: 'invoice',
    label: 'Quick invoice',
    shortLabel: 'Invoice',
    description: 'Invoice for a one-time customer, with the same line-item arithmetic as a stored invoice.',
    permission: 'billing.invoice.create',
    printPermission: 'billing.invoice.view',
    referencePrefix: 'QI',
    limitation: 'A quick invoice is not recorded in the books and does not use an invoice number. Record it on the Invoices page when it must appear in the accounts.',
  },
  receipt: {
    kind: 'receipt',
    label: 'Quick receipt',
    shortLabel: 'Receipt',
    description: 'Payment receipt for a walk-in customer or a payment that is not linked to a stored invoice.',
    permission: 'billing.payment.create',
    printPermission: 'billing.payment.view',
    referencePrefix: 'QR',
    limitation: 'A quick receipt is not posted to the payment ledger. Use the Invoices page to record a payment against a stored invoice.',
  },
  'visit-summary': {
    kind: 'visit-summary',
    label: 'Quick examination report',
    shortLabel: 'Examination report',
    description: 'Examination findings and treatment given for a walk-in patient, printed with the visit-summary template.',
    permission: 'clinical.visit.create',
    printPermission: 'clinical.view',
    referencePrefix: 'QV',
    limitation: 'No visit is stored for the walk-in customer — the printed or saved report is the only record.',
  },
  'appointment-card': {
    kind: 'appointment-card',
    label: 'Quick appointment card',
    shortLabel: 'Appointment card',
    description: 'Appointment card for a customer who is not registered yet, using the appointment-card template.',
    permission: 'appointments.manage',
    printPermission: 'appointments.view',
    referencePrefix: 'QA',
    limitation: 'The appointment is not added to the schedule. Add it on the Appointments page if the clinic must track it.',
  },
};

/* --------------------------------------------------------------- payloads */

export interface QuickCustomer {
  /** Customer / patient name exactly as it should print. */
  name: string;
  ageYears: number | null;
  gender: string;
  phone: string | null;
}

export interface QuickMedicineItem {
  medicineName: string;
  generic: string | null;
  strength: string | null;
  form: string | null;
  dosage: string | null;
  frequency: string | null;
  duration: string | null;
  qty: string | null;
  instruction: string | null;
  /** Optional one-line medicine instruction; absent in older transient payloads. */
  medicineInstruction?: string | null;
}

export interface QuickInvoiceLine {
  description: string;
  qty: number;
  unitPricePaisa: number;
  discountPaisa: number;
}

export interface QuickProcedure {
  toothNumber: string | null;
  treatmentName: string;
  qty: number;
  unitPricePaisa: number;
}

export interface QuickPrescriptionPayload {
  reference: string;
  date: string;
  dentistName: string | null;
  dentistId: number | null;
  customer: QuickCustomer;
  cC: string | null;
  oE: string | null;
  rE: string | null;
  diagnosis: string | null;
  treatment: string | null;
  advice: string | null;
  followUp: string | null;
  items: QuickMedicineItem[];
}

export interface QuickInvoicePayload {
  reference: string;
  date: string;
  customer: QuickCustomer;
  lines: QuickInvoiceLine[];
  invoiceDiscountPaisa: number;
  /** Amount handed over at the counter; 0 when nothing was paid yet. */
  amountReceivedPaisa: number;
  method: string | null;
  note: string | null;
}

export interface QuickReceiptPayload {
  reference: string;
  date: string;
  customer: QuickCustomer;
  amountPaisa: number;
  method: string | null;
  paymentReference: string | null;
}

export interface QuickVisitSummaryPayload {
  reference: string;
  date: string;
  customer: QuickCustomer;
  dentistName: string | null;
  chiefComplaint: string | null;
  diagnosis: string | null;
  treatmentNotes: string | null;
  procedures: QuickProcedure[];
  nextVisitDate: string | null;
  nextVisitPurpose: string | null;
}

export interface QuickAppointmentCardPayload {
  reference: string;
  date: string;
  time: string;
  customer: QuickCustomer;
  dentistName: string | null;
  purpose: string | null;
  durationMin: number;
}

export type QuickDocumentPayload =
  | QuickPrescriptionPayload
  | QuickInvoicePayload
  | QuickReceiptPayload
  | QuickVisitSummaryPayload
  | QuickAppointmentCardPayload;

export interface QuickDocumentInput {
  kind: QuickDocumentKind;
  payload: QuickDocumentPayload;
}

/* ------------------------------------------------------------- validation */

export interface QuickValidationResult {
  input: QuickDocumentInput | null;
  errors: string[];
}

const LIMITS = {
  name: 120,
  phone: 40,
  gender: 20,
  reference: 40,
  short: 160,
  text: 2000,
  medicine: 160,
  line: 300,
  purpose: 160,
} as const;

const MAX_MONEY_PAISA = 100_000_000_00;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Trimmed string, or null when empty/absent. Rejects anything over `max`. */
function str(value: unknown, max: number, label: string, errors: string[], required = false): string | null {
  if (value === null || value === undefined) {
    if (required) errors.push(`${label} is required.`);
    return null;
  }
  if (typeof value !== 'string') {
    errors.push(`${label} must be text.`);
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    if (required) errors.push(`${label} is required.`);
    return null;
  }
  if (trimmed.length > max) {
    errors.push(`${label} must be ${max} characters or fewer.`);
    return null;
  }
  return trimmed;
}

/** Optional one-line text kept verbatim (including spacing); whitespace-only values become null. */
function verbatimStr(value: unknown, max: number, label: string, errors: string[]): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') {
    errors.push(`${label} must be text.`);
    return null;
  }
  if (value.trim() === '') return null;
  if (value.length > max) {
    errors.push(`${label} must be ${max} characters or fewer.`);
    return null;
  }
  return value;
}

function int(value: unknown, min: number, max: number, label: string, errors: string[]): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    errors.push(`${label} must be a number.`);
    return min;
  }
  const rounded = Math.round(n);
  if (rounded < min || rounded > max) {
    errors.push(`${label} must be between ${min} and ${max}.`);
    return min;
  }
  return rounded;
}

function isoDate(value: unknown, label: string, errors: string[], required = true): string | null {
  const text = str(value, 10, label, errors, required);
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    errors.push(`${label} must be a date.`);
    return null;
  }
  const parsed = new Date(`${text}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    errors.push(`${label} must be a valid date.`);
    return null;
  }
  return text;
}

function timeOfDay(value: unknown, label: string, errors: string[]): string {
  const text = str(value, 5, label, errors, true) ?? '00:00';
  if (!/^\d{2}:\d{2}$/.test(text)) {
    errors.push(`${label} must use HH:MM.`);
    return '00:00';
  }
  const [h, m] = text.split(':').map(Number);
  if (h < 0 || h > 23 || m < 0 || m > 59) {
    errors.push(`${label} must be a valid time.`);
    return '00:00';
  }
  return text;
}

function customer(raw: unknown, errors: string[]): QuickCustomer {
  const source = isRecord(raw) ? raw : {};
  const ageValue = source.ageYears;
  let ageYears: number | null = null;
  if (ageValue !== null && ageValue !== undefined && ageValue !== '') {
    ageYears = int(ageValue, 0, 130, 'Age', errors);
  }
  return {
    name: str(source.name, LIMITS.name, 'Customer name', errors, true) ?? '',
    ageYears,
    gender: str(source.gender, LIMITS.gender, 'Gender', errors) ?? '',
    phone: str(source.phone, LIMITS.phone, 'Phone', errors),
  };
}

function medicineItems(raw: unknown, errors: string[]): QuickMedicineItem[] {
  if (!Array.isArray(raw)) {
    errors.push('Add at least one medicine.');
    return [];
  }
  const items: QuickMedicineItem[] = [];
  raw.forEach((entry, index) => {
    const source = isRecord(entry) ? entry : {};
    const name = str(source.medicineName, LIMITS.medicine, `Medicine #${index + 1} name`, errors, true);
    if (!name) return;
    items.push({
      medicineName: name,
      generic: str(source.generic, LIMITS.medicine, `Medicine #${index + 1} generic`, errors),
      strength: str(source.strength, LIMITS.medicine, `Medicine #${index + 1} strength`, errors),
      form: str(source.form, LIMITS.medicine, `Medicine #${index + 1} form`, errors),
      dosage: str(source.dosage, LIMITS.medicine, `Medicine #${index + 1} dosage`, errors),
      frequency: str(source.frequency, LIMITS.medicine, `Medicine #${index + 1} frequency`, errors),
      duration: str(source.duration, LIMITS.medicine, `Medicine #${index + 1} duration`, errors),
      qty: str(source.qty, LIMITS.medicine, `Medicine #${index + 1} quantity`, errors),
      instruction: str(source.instruction, LIMITS.medicine, `Medicine #${index + 1} administration note`, errors),
      medicineInstruction: verbatimStr(source.medicineInstruction, 500, `Medicine #${index + 1} one-line instruction`, errors),
    });
  });
  if (items.length === 0 && errors.length === 0) errors.push('Add at least one medicine.');
  return items.slice(0, 60);
}

function invoiceLines(raw: unknown, errors: string[]): QuickInvoiceLine[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    errors.push('Add at least one invoice line.');
    return [];
  }
  const lines: QuickInvoiceLine[] = [];
  raw.slice(0, 200).forEach((entry, index) => {
    const source = isRecord(entry) ? entry : {};
    const description = str(source.description, LIMITS.line, `Line #${index + 1} description`, errors, true);
    if (!description) return;
    const qty = int(source.qty ?? 1, 1, 100_000, `Line #${index + 1} quantity`, errors);
    const unitPricePaisa = int(source.unitPricePaisa, 0, MAX_MONEY_PAISA, `Line #${index + 1} unit price`, errors);
    const discountPaisa = int(source.discountPaisa ?? 0, 0, MAX_MONEY_PAISA, `Line #${index + 1} discount`, errors);
    if (discountPaisa > qty * unitPricePaisa) {
      errors.push(`Line #${index + 1} discount exceeds the line total.`);
      return;
    }
    lines.push({ description, qty, unitPricePaisa, discountPaisa });
  });
  if (lines.length === 0 && errors.length === 0) errors.push('Add at least one invoice line.');
  return lines;
}

function procedures(raw: unknown, errors: string[]): QuickProcedure[] {
  if (!Array.isArray(raw)) return [];
  const out: QuickProcedure[] = [];
  raw.slice(0, 100).forEach((entry, index) => {
    const source = isRecord(entry) ? entry : {};
    const treatmentName = str(source.treatmentName, LIMITS.line, `Procedure #${index + 1} name`, errors);
    if (!treatmentName) return;
    out.push({
      toothNumber: str(source.toothNumber, 40, `Procedure #${index + 1} tooth`, errors),
      treatmentName,
      qty: int(source.qty ?? 1, 1, 10_000, `Procedure #${index + 1} quantity`, errors),
      unitPricePaisa: int(source.unitPricePaisa ?? 0, 0, MAX_MONEY_PAISA, `Procedure #${index + 1} price`, errors),
    });
  });
  return out;
}

/**
 * Validate an untrusted quick-document payload (renderer → main). Everything is
 * bounded and normalized; `input` is null when any error was found.
 */
export function validateQuickDocumentInput(raw: unknown): QuickValidationResult {
  const errors: string[] = [];
  const source = isRecord(raw) ? raw : {};
  const kind = source.kind;
  if (typeof kind !== 'string' || !(kind in QUICK_DOCUMENT_DEFS)) {
    return { input: null, errors: ['Unknown quick document type.'] };
  }
  const payload = isRecord(source.payload) ? source.payload : {};
  const key = kind as QuickDocumentKind;
  const reference = str(payload.reference, LIMITS.reference, 'Reference', errors, true) ?? '';
  const date = isoDate(payload.date, 'Date', errors) ?? '';
  const who = customer(payload.customer, errors);

  let value: QuickDocumentPayload | null = null;
  switch (key) {
    case 'prescription': {
      // A dentist chosen from the clinic's list carries the name with it, so a
      // free-text name is only required when no dentist was selected.
      const dentistId = payload.dentistId === null || payload.dentistId === undefined || payload.dentistId === ''
        ? null
        : int(payload.dentistId, 1, Number.MAX_SAFE_INTEGER, 'Dentist', errors);
      value = {
        reference, date, customer: who,
        dentistId,
        dentistName: str(payload.dentistName, LIMITS.short, 'Dentist name', errors, dentistId === null),
        cC: str(payload.cC, LIMITS.short, 'C/C', errors),
        oE: str(payload.oE, LIMITS.short, 'O/E', errors),
        rE: str(payload.rE, LIMITS.text, 'R/E', errors),
        diagnosis: str(payload.diagnosis, LIMITS.short, 'Diagnosis', errors),
        treatment: str(payload.treatment, LIMITS.short, 'Treatment', errors),
        advice: str(payload.advice, LIMITS.text, 'Advice', errors),
        followUp: isoDate(payload.followUp, 'Follow-up date', errors, false),
        items: medicineItems(payload.items, errors),
      } satisfies QuickPrescriptionPayload;
      break;
    }
    case 'invoice': {
      const lines = invoiceLines(payload.lines, errors);
      value = {
        reference, date, customer: who, lines,
        invoiceDiscountPaisa: int(payload.invoiceDiscountPaisa ?? 0, 0, MAX_MONEY_PAISA, 'Discount', errors),
        amountReceivedPaisa: int(payload.amountReceivedPaisa ?? 0, 0, MAX_MONEY_PAISA, 'Received amount', errors),
        method: str(payload.method, LIMITS.short, 'Payment method', errors),
        note: str(payload.note, LIMITS.text, 'Note', errors),
      } satisfies QuickInvoicePayload;
      break;
    }
    case 'receipt': {
      const amount = int(payload.amountPaisa, 1, MAX_MONEY_PAISA, 'Amount received', errors);
      value = {
        reference, date, customer: who, amountPaisa: amount,
        method: str(payload.method, LIMITS.short, 'Payment method', errors),
        paymentReference: str(payload.paymentReference, LIMITS.short, 'Payment reference', errors),
      } satisfies QuickReceiptPayload;
      break;
    }
    case 'visit-summary': {
      value = {
        reference, date, customer: who,
        dentistName: str(payload.dentistName, LIMITS.short, 'Dentist name', errors),
        chiefComplaint: str(payload.chiefComplaint, LIMITS.text, 'Chief complaint', errors),
        diagnosis: str(payload.diagnosis, LIMITS.text, 'Diagnosis', errors),
        treatmentNotes: str(payload.treatmentNotes, LIMITS.text, 'Treatment done', errors),
        procedures: procedures(payload.procedures, errors),
        nextVisitDate: isoDate(payload.nextVisitDate, 'Next visit date', errors, false),
        nextVisitPurpose: str(payload.nextVisitPurpose, LIMITS.purpose, 'Next visit purpose', errors),
      } satisfies QuickVisitSummaryPayload;
      break;
    }
    case 'appointment-card': {
      value = {
        reference, date,
        time: timeOfDay(payload.time, 'Time', errors),
        customer: who,
        dentistName: str(payload.dentistName, LIMITS.short, 'Dentist name', errors),
        purpose: str(payload.purpose, LIMITS.purpose, 'Purpose', errors),
        durationMin: int(payload.durationMin ?? 30, 5, 600, 'Duration', errors),
      } satisfies QuickAppointmentCardPayload;
      break;
    }
  }

  if (errors.length > 0 || !value) return { input: null, errors };
  return { input: { kind: key, payload: value }, errors: [] };
}

/* -------------------------------------------------------------- utilities */

/**
 * Human-readable reference for a quick document, e.g. `QP-20261014-1042`.
 * Deliberately prefixed per document type and outside the `INV-YYYY-NNNNN`
 * invoice series, so a quick document can never be mistaken for (or collide
 * with) a numbered accounting invoice.
 */
export function quickDocumentReference(kind: QuickDocumentKind, at: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  return `${QUICK_DOCUMENT_DEFS[kind].referencePrefix}-${stamp}`;
}

/** Suggested file name for “Save as PDF”, clearly marked as a quick document. */
export function quickDocumentFileName(kind: QuickDocumentKind, payload: QuickDocumentPayload): string {
  const who = payload.customer.name.replace(/[^A-Za-z0-9-_ ]+/g, '').trim() || 'Walk-in';
  return `${QUICK_DOCUMENT_DEFS[kind].referencePrefix}-${who}-${payload.reference}`.replace(/[^A-Za-z0-9-_ ]+/g, '').slice(0, 80);
}
