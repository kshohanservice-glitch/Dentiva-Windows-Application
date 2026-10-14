/**
 * Fixed sample data for every printable document.
 *
 * Two consumers:
 *   1. Settings → Customize Documents and Walk-in / Quick Documents preview the
 *      **real** renderers with this data, so the preview matches the printout;
 *   2. `tests/unit/document-layout.test.ts` compares the current renderers with
 *      the frozen pre-customization copies using exactly these payloads.
 *
 * Deliberately free of `new Date()`-derived values so two runs produce the same
 * markup. Documents that do use the clock (receipt date, stock-label expiry
 * countdown) are normalized by `normalizeDocumentMarkup`.
 */

const CLINIC = {
  clinicName: 'BrightSmile Dental Clinic',
  clinicNameBn: 'ব্রাইটস্মাইল ডেন্টাল ক্লিনিক',
  logoPath: 'C:/Dentiva/logo.png',
  logoDataUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  address: '12 Lake View Road, Dhanmondi, Dhaka 1205',
  phone: '+880 1700-000000',
  email: 'care@brightsmile.example',
  website: 'www.brightsmile.example',
  operatingHours: '10:00 – 20:00',
  visitingDays: 'Sat – Thu',
  currency: 'BDT',
  timezone: 'Asia/Dhaka',
};

const SETTINGS = {
  clinic: CLINIC,
  prescription: {
    footerMessage: 'Dhaka · appointments +880 1700-000000',
    visitingHours: 'Visiting hours 10:00 – 20:00 (Sat – Thu)',
    signatureReserved: true,
    labels: {
      cc: 'C/C', oe: 'O/E', re: 'R/E', diagnosis: 'Diagnosis',
      treatment: 'Treatment', advice: 'Advice', followUp: 'Follow-up',
      medicineInstruction: 'Medicine Instruction',
    },
  },
  invoice: { nextNumber: 'INV-2026-00042', footerNote: 'Thank you for your visit.' },
};

const PATIENT = {
  id: 7,
  name: 'Farhana Islam',
  patientCode: 'P-000123',
  ageYears: 34,
  gender: 'Female',
  phone: '+880 1811-222333',
  dob: '1992-03-04',
};

const DENTIST = {
  id: 3,
  name: 'Dr. Ayesha Rahman',
  qualifications: 'BDS, MPH',
  designations: 'Consultant Dentist',
  regNo: 'BMDC-D-45821',
  phone: '+880 1711-111111',
  email: 'ayesha@brightsmile.example',
  signaturePath: null,
  photoPath: null,
  schedule: null,
  active: true,
};

const PRESCRIPTION = {
  id: 21,
  rxNumber: 'RX-2026-00231',
  rxDate: '2026-06-15',
  dentistId: 3,
  dentistName: 'Dr. Ayesha Rahman',
  cC: 'Pain in the lower right back tooth',
  oE: 'Deep caries 36, tender on percussion',
  rE: 'IOPA 36 — radiolucency approaching the pulp',
  diagnosis: 'Irreversible pulpitis 36',
  treatment: 'Root canal treatment (36), first sitting',
  advice: 'Soft diet for 24 hours. Warm salt-water rinse twice a day.',
  medicineInstruction: 'Tab.Napa - 100MG - 1+0+1 - 7 days - after meals',
  followUp: '2026-06-22',
  items: [
    {
      seq: 1, medicineName: 'Amoxicillin', generic: 'Amoxicillin trihydrate', strength: '500mg',
      form: 'Capsule', dosage: '1 capsule', frequency: '3× daily', duration: '5 days',
      qty: '15', instruction: 'after meals', route: 'Oral',
    },
    {
      seq: 2, medicineName: 'Ibuprofen', generic: 'Ibuprofen BP', strength: '400mg',
      form: 'Tablet', dosage: '1 tablet', frequency: '2× daily', duration: '3 days',
      qty: '6', instruction: 'after food', route: 'Oral',
    },
  ],
};

const INVOICE = {
  id: 11,
  invoiceNumber: 'INV-2026-00041',
  invoiceDate: '2026-06-15',
  patientId: 7,
  patientName: 'Farhana Islam',
  patientCode: 'P-000123',
  patientPhone: '+880 1811-222333',
  dentistName: 'Dr. Ayesha Rahman',
  status: 'partial',
  subtotalPaisa: 960000,
  discountPaisa: 80000,
  vatPaisa: 0,
  totalPaisa: 880000,
  paidPaisa: 500000,
  duePaisa: 380000,
  footerNote: 'Thank you for your visit.',
  lines: [
    { id: 1, description: 'Dental consultation', toothNumber: null, quantity: 1, unitPricePaisa: 80000, totalPaisa: 80000 },
    { id: 2, description: 'Root canal treatment', toothNumber: 36, quantity: 1, unitPricePaisa: 650000, totalPaisa: 650000 },
    { id: 3, description: 'IOPA X-ray', toothNumber: null, quantity: 2, unitPricePaisa: 100000, totalPaisa: 200000 },
  ],
};

const PAYMENTS = [
  { id: 1, paidAt: '2026-06-15T11:20:00', method: 'Cash', reference: 'RC-0007', amountPaisa: 500000 },
  { id: 2, paidAt: '2026-06-15T18:40:00', method: 'bKash', reference: 'BK-99120', amountPaisa: 0 },
];

const VISIT = {
  id: 33,
  visitDate: '2026-06-15',
  chiefComplaint: 'Pain in the lower right back tooth for three days',
  diagnosis: 'Irreversible pulpitis 36',
  treatmentNotes: 'Access opening and pulpectomy completed under local anaesthesia.',
  dentistName: 'Dr. Ayesha Rahman',
  nextVisitDate: '2026-06-22',
  nextVisitPurpose: 'Obturation (36)',
};

const REPORT = {
  title: 'Daily collection summary',
  scope: '01/06/2026 – 15/06/2026',
  generatedAt: '2026-06-15',
  columns: [
    { key: 'date', label: 'Date', align: 'left' as const },
    { key: 'invoices', label: 'Invoices', align: 'right' as const },
    { key: 'collected', label: 'Collected', align: 'right' as const },
  ],
  rows: [
    { date: '15/06/2026', invoices: 4, collected: 1250000 },
    { date: '14/06/2026', invoices: 6, collected: 1880000 },
    { date: '13/06/2026', invoices: 3, collected: 960000 },
  ],
  totals: { date: 'Total', invoices: 13, collected: 4090000 },
};

const deep = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** Sample payloads keyed by document type, in the shape each renderer expects. */
export const DOCUMENT_SAMPLES: Record<string, () => any> = {
  prescription: () => ({
    rx: deep(PRESCRIPTION), patient: deep(PATIENT), clinic: deep(CLINIC), visit: null,
    watermark: false, settings: deep(SETTINGS), dentist: deep(DENTIST),
  }),
  'prescription-duplicate': () => ({
    rx: deep(PRESCRIPTION), patient: deep(PATIENT), clinic: deep(CLINIC), visit: null,
    watermark: true, settings: deep(SETTINGS), dentist: deep(DENTIST),
  }),
  invoice: () => ({ invoice: deep(INVOICE), payments: deep(PAYMENTS), clinic: deep(CLINIC), settings: deep(SETTINGS) }),
  receipt: () => ({ invoice: deep(INVOICE), payments: deep(PAYMENTS), clinic: deep(CLINIC) }),
  'visit-summary': () => ({
    patient: deep(PATIENT),
    visit: deep(VISIT),
    procedures: [
      { id: 1, toothNumber: '36', treatmentName: 'Access opening & pulpectomy', qty: 1, unitPricePaisa: 450000, totalPaisa: 450000 },
      { id: 2, toothNumber: '36', treatmentName: 'IOPA radiograph', qty: 1, unitPricePaisa: 100000, totalPaisa: 100000 },
    ],
    rx: [{ id: 1, rxNumber: 'RX-2026-00231', items: [{ medicineName: 'Amoxicillin', strength: '500mg', dosage: '1 capsule' }] }],
    clinic: deep(CLINIC),
    settings: deep(SETTINGS),
  }),
  'appointment-card': () => ({
    appointment: { id: 5, date: '2026-06-22', time: '10:30', dentistName: 'Dr. Ayesha Rahman', purpose: 'Obturation (36)' },
    patient: { name: 'Farhana Islam', phone: '+880 1811-222333' },
    clinic: deep(CLINIC),
  }),
  'stock-labels': () => ({
    items: [
      { id: 1, name: 'Composite resin A2', batchNumber: 'CR-A2-0912', expiryDate: '2030-09-30', quantity: 12, unit: 'syringe' },
      { id: 2, name: 'Lidocaine 2% with adrenaline', batchNumber: 'LD-2411', expiryDate: '2030-08-15', quantity: 30, unit: 'cartridge' },
    ],
    clinic: deep(CLINIC),
    expiryThresholdDays: 90,
  }),
  report: () => ({ report: deep(REPORT), clinic: deep(CLINIC) }),
};

/**
 * Normalize the clock-dependent parts of rendered markup so the same document
 * can be compared across runs (receipt date, expiry countdown).
 */
export function normalizeDocumentMarkup(html: string): string {
  return html
    .replace(/\d{2}\/\d{2}\/\d{4}/g, '{{DATE}}')
    .replace(/EXPIRES IN -?\d+d/g, 'EXPIRES IN {{DAYS}}d')
    .replace(/\d{1,2}:\d{2}\s?(am|pm)/gi, '{{TIME}}');
}

/** Remove the customization markers, which add no styling and no nodes. */
export function stripDocumentMarkers(html: string): string {
  return html.replace(/ data-doc-el="[^"]*"/g, '');
}
