/**
 * Printable-document customization model (Feature: Settings → Customize Documents).
 *
 * Design rule — the original design stays the source of truth:
 *
 *     original document design + validated user overrides = final printable document
 *
 * Nothing in this module restyles a document by itself. Renderers tag their own
 * existing nodes with a stable `data-doc-el="<document>.<section>.<element>"`
 * attribute and keep every original class, font, spacing and border. A
 * customization only ever *adds* a rule for a tagged node when — and only
 * when — the user stored an override for that exact element, so an untouched
 * document renders byte-for-byte as it did before this feature existed.
 *
 * Element targeting is by stable identifier, never by text, so a customization
 * keeps applying when the content changes between patients or documents.
 */

/* ------------------------------------------------------------------ types */

export type CustomizableDocumentType =
  | 'prescription'
  | 'invoice'
  | 'receipt'
  | 'visit-summary'
  | 'appointment-card'
  | 'stock-labels'
  | 'report';

export type DocumentSection = 'header' | 'body' | 'tables' | 'footer';

export type DocumentStylePropKey =
  | 'color'
  | 'fontSize'
  | 'fontWeight'
  | 'fontFamily'
  | 'textAlign'
  | 'lineHeight'
  | 'letterSpacing'
  | 'marginTop'
  | 'marginRight'
  | 'marginBottom'
  | 'marginLeft'
  | 'paddingTop'
  | 'paddingRight'
  | 'paddingBottom'
  | 'paddingLeft'
  | 'borderBottomWidth'
  | 'borderBottomStyle'
  | 'borderBottomColor'
  | 'backgroundColor'
  | 'width'
  | 'columnWidth'
  | 'visible';

export interface DocumentElementStyle {
  color?: string;
  fontSize?: number;
  fontWeight?: number;
  fontFamily?: DocumentFontKey;
  textAlign?: 'left' | 'center' | 'right';
  lineHeight?: number;
  letterSpacing?: number;
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  borderBottomWidth?: number;
  borderBottomStyle?: 'solid' | 'dashed' | 'dotted' | 'none';
  borderBottomColor?: string;
  backgroundColor?: string;
  /** Image size in CSS pixels (clinic logo). */
  width?: number;
  /** Table-column width as a percentage of the table. */
  columnWidth?: number;
  /** `false` hides a declared optional element. Required elements cannot be hidden. */
  visible?: boolean;
}

export type DocumentElementOverrides = Record<string, DocumentElementStyle>;

/** Per-document, per-element overrides. An absent document/element/property uses the original design. */
export type DocumentStyleMap = Partial<Record<CustomizableDocumentType, DocumentElementOverrides>>;

export interface DocumentElementDef {
  /** Stable identifier — never derived from the current text content. */
  id: string;
  label: string;
  section: DocumentSection;
  props: DocumentStylePropKey[];
  /** Optional elements may be hidden; required content may not. */
  optional?: boolean;
  /** Apply the generated rule to these child nodes instead of the tagged node. */
  descendant?: 'th' | 'td';
  hint?: string;
}

export interface DocumentTypeDef {
  type: CustomizableDocumentType;
  label: string;
  description: string;
  elements: DocumentElementDef[];
}

/* --------------------------------------------------------------- property UI */

export interface DocumentStylePropDef {
  key: DocumentStylePropKey;
  label: string;
  control: 'color' | 'number' | 'select' | 'toggle';
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: { value: string; label: string }[];
}

export type DocumentFontKey = keyof typeof DOCUMENT_FONTS;

export const DOCUMENT_FONTS = {
  inter: { label: 'Inter (default)', stack: "'Inter', 'Noto Sans Bengali', 'Segoe UI', sans-serif" },
  bengali: { label: 'Noto Sans Bengali', stack: "'Noto Sans Bengali', 'Inter', 'Segoe UI', sans-serif" },
  serif: { label: 'Serif (Georgia)', stack: "Georgia, 'Times New Roman', serif" },
  mono: { label: 'Monospace (Consolas)', stack: "Consolas, ui-monospace, 'Cascadia Mono', monospace" },
} as const;

/** Numeric bounds keep every stored value inside a range that cannot break layout. */
const NUMERIC_BOUNDS: Partial<Record<DocumentStylePropKey, { min: number; max: number; step: number; integer?: boolean }>> = {
  fontSize: { min: 6, max: 48, step: 0.5 },
  fontWeight: { min: 100, max: 900, step: 100, integer: true },
  lineHeight: { min: 0.8, max: 3, step: 0.05 },
  letterSpacing: { min: -1, max: 5, step: 0.1 },
  marginTop: { min: 0, max: 40, step: 1 },
  marginRight: { min: 0, max: 40, step: 1 },
  marginBottom: { min: 0, max: 40, step: 1 },
  marginLeft: { min: 0, max: 40, step: 1 },
  paddingTop: { min: 0, max: 24, step: 1 },
  paddingRight: { min: 0, max: 24, step: 1 },
  paddingBottom: { min: 0, max: 24, step: 1 },
  paddingLeft: { min: 0, max: 24, step: 1 },
  borderBottomWidth: { min: 0, max: 4, step: 0.5 },
  width: { min: 8, max: 200, step: 1 },
  columnWidth: { min: 5, max: 95, step: 1 },
};

const PROP_LABELS: Record<DocumentStylePropKey, string> = {
  color: 'Text colour',
  fontSize: 'Font size',
  fontWeight: 'Font weight',
  fontFamily: 'Font family',
  textAlign: 'Alignment',
  lineHeight: 'Line height',
  letterSpacing: 'Letter spacing',
  marginTop: 'Margin top',
  marginRight: 'Margin right',
  marginBottom: 'Margin bottom',
  marginLeft: 'Margin left',
  paddingTop: 'Padding top',
  paddingRight: 'Padding right',
  paddingBottom: 'Padding bottom',
  paddingLeft: 'Padding left',
  borderBottomWidth: 'Border width',
  borderBottomStyle: 'Border style',
  borderBottomColor: 'Border colour',
  backgroundColor: 'Background',
  width: 'Size',
  columnWidth: 'Column width',
  visible: 'Visibility',
};

/** Control metadata for the Customize Documents panel. */
export function propDef(key: DocumentStylePropKey): DocumentStylePropDef {
  const bounds = NUMERIC_BOUNDS[key];
  if (bounds) return { key, label: PROP_LABELS[key], control: 'number', step: bounds.step, min: bounds.min, max: bounds.max };
  if (key === 'color' || key === 'borderBottomColor' || key === 'backgroundColor') {
    return { key, label: PROP_LABELS[key], control: 'color' };
  }
  if (key === 'fontFamily') {
    return {
      key, label: PROP_LABELS[key], control: 'select',
      options: Object.entries(DOCUMENT_FONTS).map(([value, f]) => ({ value, label: f.label })),
    };
  }
  if (key === 'textAlign') {
    return {
      key, label: PROP_LABELS[key], control: 'select',
      options: [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }],
    };
  }
  if (key === 'borderBottomStyle') {
    return {
      key, label: PROP_LABELS[key], control: 'select',
      options: [
        { value: 'solid', label: 'Solid' },
        { value: 'dashed', label: 'Dashed' },
        { value: 'dotted', label: 'Dotted' },
        { value: 'none', label: 'None' },
      ],
    };
  }
  return { key, label: PROP_LABELS[key], control: 'toggle' };
}

/* ------------------------------------------------------------- prop presets */

const TEXT: DocumentStylePropKey[] = ['color', 'fontSize', 'fontWeight', 'fontFamily', 'lineHeight', 'letterSpacing', 'textAlign'];
const SPACE: DocumentStylePropKey[] = [
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
];
const RULE: DocumentStylePropKey[] = ['borderBottomWidth', 'borderBottomStyle', 'borderBottomColor'];
const FILL: DocumentStylePropKey[] = ['backgroundColor'];

/** Text line with full typography plus spacing. */
const LINE: DocumentStylePropKey[] = [...TEXT, ...SPACE];
/** Text line with typography only (inside a grid/flex row where margins would distort the layout). */
const INLINE: DocumentStylePropKey[] = [...TEXT];
/** Table header cell group. */
const TH: DocumentStylePropKey[] = [...TEXT, ...SPACE, ...RULE, ...FILL];
/** Table body cell group. */
const TD: DocumentStylePropKey[] = [...TEXT, ...SPACE, ...RULE, ...FILL];
/** Cell inside the narrow totals table (padding only, so the totals column cannot overflow). */
const TOTAL_CELL: DocumentStylePropKey[] = ['color', 'fontSize', 'fontWeight', 'fontFamily', 'textAlign', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight'];

/* ------------------------------------------------------------ registry utils */

function el(
  id: string,
  label: string,
  section: DocumentSection,
  props: DocumentStylePropKey[],
  extra: Partial<DocumentElementDef> = {},
): DocumentElementDef {
  // Every element declared optional implicitly offers the visibility control;
  // required content is never offered a way to disappear from a printout.
  const all = extra.optional && !props.includes('visible') ? [...props, 'visible' as DocumentStylePropKey] : props;
  return { id, label, section, props: all, ...extra };
}

/**
 * Header elements of the shared document header (`Header` in
 * print-documents.tsx). Every document that uses that header gets the same set
 * of independently customizable lines, scoped to its own document type.
 */
function sharedHeaderElements(type: Exclude<CustomizableDocumentType, 'prescription'>): DocumentElementDef[] {
  return [
    el(`${type}.header.logo`, 'Clinic logo', 'header', ['width', 'marginRight', 'visible'],
      { optional: true, hint: 'Printed only when a clinic logo is configured.' }),
    el(`${type}.header.clinicName`, 'Clinic name', 'header', LINE),
    el(`${type}.header.clinicAddress`, 'Clinic address', 'header', LINE, { optional: true }),
    el(`${type}.header.clinicContact`, 'Clinic phone / email line', 'header', LINE),
    el(`${type}.header.meta`, 'Document meta block (right)', 'header', LINE),
    el(`${type}.header.separator`, 'Header separator line', 'header', [...RULE, 'paddingBottom']),
  ];
}

/** Footer elements of the shared document footer (`Footer` in print-documents.tsx). */
function sharedFooterElements(type: CustomizableDocumentType): DocumentElementDef[] {
  return [
    el(`${type}.footer.separator`, 'Footer separator line', 'footer', [...RULE, 'paddingTop']),
    el(`${type}.footer.text`, 'Footer note', 'footer', LINE, { optional: true }),
    el(`${type}.footer.generated`, '“Computer-generated document” line', 'footer', [...INLINE, 'visible'], { optional: true }),
  ];
}

/* -------------------------------------------------------------- registry data */

const PRESCRIPTION_ELEMENTS: DocumentElementDef[] = [
  el('prescription.header.logo', 'Clinic logo', 'header', ['width', 'marginRight', 'visible'],
    { optional: true, hint: 'Printed only when a clinic logo is configured.' }),
  el('prescription.header.clinicName', 'Clinic name', 'header', LINE),
  el('prescription.header.clinicNameBn', 'Clinic name (Bengali)', 'header', LINE, { optional: true }),
  el('prescription.header.clinicAddress', 'Clinic address', 'header', LINE, { optional: true }),
  el('prescription.header.clinicContact', 'Clinic phone / email / website', 'header', LINE),
  el('prescription.header.dentistLabel', '“DENTIST” label', 'header', LINE, { optional: true }),
  el('prescription.header.dentistName', 'Dentist name', 'header', LINE),
  el('prescription.header.dentistDesignation', 'Dentist designation line', 'header', LINE, { optional: true }),
  el('prescription.header.dentistQualification', 'Dentist qualification line', 'header', LINE, { optional: true }),
  el('prescription.header.dentistOther', 'Dentist registration / contact', 'header', LINE, { optional: true }),
  el('prescription.header.separator', 'Header separator line', 'header', [...RULE, 'paddingBottom']),

  el('prescription.body.patientStrip', 'Patient strip background', 'body', [...SPACE, ...FILL, ...RULE]),
  el('prescription.body.patientLabel', 'Patient strip labels', 'body', INLINE),
  el('prescription.body.patientValue', 'Patient strip values', 'body', INLINE),
  el('prescription.body.visitingHours', 'Visiting-hours line', 'body', LINE, { optional: true }),
  el('prescription.body.clinicalTitle', '“Clinical Notes” heading', 'body', LINE),
  el('prescription.body.clinicalLabel', 'Clinical field labels (C/C, O/E, R/E…)', 'body', INLINE),
  el('prescription.body.clinicalValue', 'Clinical field values', 'body', INLINE),
  el('prescription.body.rxSymbol', '“Rx” symbol', 'body', INLINE),
  el('prescription.body.rxHeading', '“Prescription” heading', 'body', INLINE),
  el('prescription.body.medicationIndex', 'Medicine number', 'body', INLINE),
  el('prescription.body.medicationTitle', 'Medicine name', 'body', INLINE),
  el('prescription.body.medicationStrength', 'Medicine strength', 'body', INLINE),
  el('prescription.body.medicationInstructions', 'Medicine instructions line', 'body', INLINE),
  el('prescription.body.medicineInstructionLabel', 'Medicine instruction label', 'body', INLINE, { optional: true, hint: 'Printed with the optional single-line medicine instruction.' }),
  el('prescription.body.medicineInstructionValue', 'Medicine instruction text', 'body', LINE, { optional: true, hint: 'The optional single-line medicine instruction, printed only when the doctor entered one.' }),
  el('prescription.body.adviceLabel', 'Advice label', 'body', INLINE),
  el('prescription.body.adviceValue', 'Advice text', 'body', INLINE),
  el('prescription.body.followUpLabel', 'Follow-up label', 'body', INLINE),
  el('prescription.body.followUpValue', 'Follow-up date', 'body', INLINE),

  el('prescription.footer.signatureNote', 'Signature note', 'footer', LINE, { optional: true }),
  el('prescription.footer.signatureLine', 'Signature line', 'footer', [...RULE, 'width']),
  el('prescription.footer.signatureName', 'Signature label', 'footer', [...INLINE, 'visible'], { optional: true }),
  ...sharedFooterElements('prescription'),
];

const INVOICE_ELEMENTS: DocumentElementDef[] = [
  ...sharedHeaderElements('invoice'),
  el('invoice.body.title', '“Invoice” title', 'body', LINE),
  el('invoice.body.infoLabel', 'Patient / invoice labels', 'body', INLINE),
  el('invoice.body.infoValue', 'Patient / invoice values', 'body', INLINE),
  el('invoice.tables.head', 'Table header cells', 'tables', TH, { descendant: 'th' }),
  el('invoice.tables.cell', 'Table body cells', 'tables', TD, { descendant: 'td' }),
  el('invoice.tables.colDescription', 'Column: Description', 'tables', ['columnWidth']),
  el('invoice.tables.colQty', 'Column: Qty', 'tables', ['columnWidth']),
  el('invoice.tables.colUnit', 'Column: Unit', 'tables', ['columnWidth']),
  el('invoice.tables.colTotal', 'Column: Total', 'tables', ['columnWidth']),
  el('invoice.tables.totalsLabel', 'Totals labels', 'tables', TOTAL_CELL),
  el('invoice.tables.totalsValue', 'Totals amounts', 'tables', TOTAL_CELL),
  el('invoice.tables.grandTotal', 'Balance-due row', 'tables', [...TOTAL_CELL, ...RULE, ...FILL], { descendant: 'td' }),
  el('invoice.tables.paymentHeading', '“Payment history” heading', 'tables', LINE),
  el('invoice.tables.paymentHead', 'Payment table header cells', 'tables', TH, { descendant: 'th' }),
  el('invoice.tables.paymentCell', 'Payment table cells', 'tables', TD, { descendant: 'td' }),
  ...sharedFooterElements('invoice'),
];

const RECEIPT_ELEMENTS: DocumentElementDef[] = [
  ...sharedHeaderElements('receipt'),
  el('receipt.body.title', '“Payment Receipt” title', 'body', LINE),
  el('receipt.body.infoLabel', 'Receipt labels', 'body', INLINE),
  el('receipt.body.infoValue', 'Receipt values', 'body', INLINE),
  el('receipt.tables.totalsLabel', 'Totals labels', 'tables', TOTAL_CELL),
  el('receipt.tables.totalsValue', 'Totals amounts', 'tables', TOTAL_CELL),
  el('receipt.tables.grandTotal', 'Balance-due row', 'tables', [...TOTAL_CELL, ...RULE, ...FILL], { descendant: 'td' }),
  el('receipt.footer.signatureLine', 'Signature line', 'footer', [...RULE, 'width']),
  el('receipt.footer.signatureLabel', '“Authorised signature” label', 'footer', [...INLINE, 'visible'], { optional: true }),
  ...sharedFooterElements('receipt'),
];

const VISIT_SUMMARY_ELEMENTS: DocumentElementDef[] = [
  ...sharedHeaderElements('visit-summary'),
  el('visit-summary.body.title', '“Visit Summary” title', 'body', LINE),
  el('visit-summary.body.infoLabel', 'Patient / visit labels', 'body', INLINE),
  el('visit-summary.body.infoValue', 'Patient / visit values', 'body', INLINE),
  el('visit-summary.body.sectionHeading', 'Section headings', 'body', [...LINE, ...RULE]),
  el('visit-summary.body.sectionText', 'Section text', 'body', LINE),
  el('visit-summary.tables.head', 'Procedure table header cells', 'tables', TH, { descendant: 'th' }),
  el('visit-summary.tables.cell', 'Procedure table cells', 'tables', TD, { descendant: 'td' }),
  ...sharedFooterElements('visit-summary'),
];

const APPOINTMENT_CARD_ELEMENTS: DocumentElementDef[] = [
  ...sharedHeaderElements('appointment-card'),
  el('appointment-card.body.title', '“Appointment Card” title', 'body', LINE),
  el('appointment-card.body.infoLabel', 'Appointment labels', 'body', INLINE),
  el('appointment-card.body.infoValue', 'Appointment values', 'body', INLINE),
  el('appointment-card.body.note', 'Arrival note', 'body', LINE),
  ...sharedFooterElements('appointment-card'),
];

const STOCK_LABEL_ELEMENTS: DocumentElementDef[] = [
  el('stock-labels.body.title', 'Label sheet title', 'body', LINE),
  el('stock-labels.tables.head', 'Label table header cells', 'tables', TH, { descendant: 'th' }),
  el('stock-labels.tables.cell', 'Label table cells', 'tables', TD, { descendant: 'td' }),
  el('stock-labels.tables.status', 'Expiry status cell', 'tables', TD),
  ...sharedFooterElements('stock-labels'),
];

const REPORT_ELEMENTS: DocumentElementDef[] = [
  ...sharedHeaderElements('report'),
  el('report.body.title', 'Report title', 'body', LINE),
  el('report.body.scope', 'Report scope line', 'body', LINE),
  el('report.tables.head', 'Report table header cells', 'tables', TH, { descendant: 'th' }),
  el('report.tables.cell', 'Report table cells', 'tables', TD, { descendant: 'td' }),
  el('report.tables.totalsLabel', 'Report totals labels', 'tables', TOTAL_CELL),
  el('report.tables.totalsValue', 'Report totals values', 'tables', TOTAL_CELL),
  ...sharedFooterElements('report'),
];

export const DOCUMENT_TYPE_DEFS: DocumentTypeDef[] = [
  {
    type: 'prescription',
    label: 'Prescription',
    description: 'Applies to prescriptions and their duplicate copies, printed from a patient profile or from Walk-in / Quick Documents.',
    elements: PRESCRIPTION_ELEMENTS,
  },
  {
    type: 'invoice',
    label: 'Invoice',
    description: 'Applies to stored invoices and to walk-in quick invoices. Amounts and arithmetic are never changed by styling.',
    elements: INVOICE_ELEMENTS,
  },
  {
    type: 'receipt',
    label: 'Payment receipt',
    description: 'Applies to receipts printed from an invoice and to walk-in quick receipts.',
    elements: RECEIPT_ELEMENTS,
  },
  {
    type: 'visit-summary',
    label: 'Visit summary / examination report',
    description: 'Applies to visit summaries printed from a patient profile and to walk-in examination reports.',
    elements: VISIT_SUMMARY_ELEMENTS,
  },
  {
    type: 'appointment-card',
    label: 'Appointment card',
    description: 'Applies to appointment cards printed from the schedule and to walk-in quick cards.',
    elements: APPOINTMENT_CARD_ELEMENTS,
  },
  {
    type: 'stock-labels',
    label: 'Stock & expiry labels',
    description: 'Inventory label sheet printed from the Inventory page.',
    elements: STOCK_LABEL_ELEMENTS,
  },
  {
    type: 'report',
    label: 'Reports',
    description: 'Clinic reports printed from the Reports page.',
    elements: REPORT_ELEMENTS,
  },
];

export const DOCUMENT_SECTIONS: DocumentSection[] = ['header', 'body', 'tables', 'footer'];

export const DOCUMENT_SECTION_LABELS: Record<DocumentSection, string> = {
  header: 'Header',
  body: 'Body',
  tables: 'Tables & totals',
  footer: 'Footer & signature',
};

const ELEMENT_INDEX = new Map<string, DocumentElementDef>();
for (const def of DOCUMENT_TYPE_DEFS) {
  for (const element of def.elements) ELEMENT_INDEX.set(element.id, element);
}

export function documentTypeDef(type: CustomizableDocumentType): DocumentTypeDef {
  return DOCUMENT_TYPE_DEFS.find((d) => d.type === type)!;
}

export function elementDef(id: string): DocumentElementDef | undefined {
  return ELEMENT_INDEX.get(id);
}

export function elementsOf(type: CustomizableDocumentType, section: DocumentSection): DocumentElementDef[] {
  return documentTypeDef(type).elements.filter((e) => e.section === section);
}

/* -------------------------------------------------------------- validation */

const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isValidHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR.test(value.trim());
}

/** Normalize a colour to lowercase `#rrggbb` (or `#rgb` when supplied that way). */
export function normalizeHexColor(value: unknown): string | undefined {
  if (!isValidHexColor(value)) return undefined;
  return value.trim().toLowerCase();
}

function clampNumber(key: DocumentStylePropKey, value: unknown): number | undefined {
  const bounds = NUMERIC_BOUNDS[key];
  if (!bounds) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  const clamped = Math.max(bounds.min, Math.min(bounds.max, bounds.integer ? Math.round(n / 100) * 100 : n));
  return Math.round(clamped * 100) / 100;
}

/**
 * Validate untrusted customization input (settings JSON, IPC payloads) into a
 * canonical map. Unknown documents, elements and properties are dropped;
 * out-of-range numbers are clamped; malformed colours are discarded and the
 * original design is used instead. Never throws.
 */
export function normalizeDocumentStyles(raw: unknown): DocumentStyleMap {
  const out: DocumentStyleMap = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const def of DOCUMENT_TYPE_DEFS) {
    const source = (raw as Record<string, unknown>)[def.type];
    if (!source || typeof source !== 'object') continue;
    const elements: DocumentElementOverrides = {};
    for (const element of def.elements) {
      const candidate = (source as Record<string, unknown>)[element.id];
      if (!candidate || typeof candidate !== 'object') continue;
      const style = normalizeElementStyle(element, candidate as Record<string, unknown>);
      if (style) elements[element.id] = style;
    }
    if (Object.keys(elements).length > 0) out[def.type] = elements;
  }
  return out;
}

/** Validate one element's overrides against that element's declared properties. */
export function normalizeElementStyle(
  element: Pick<DocumentElementDef, 'props' | 'optional'> & { id?: string },
  raw: Record<string, unknown>,
): DocumentElementStyle | undefined {
  const style: DocumentElementStyle = {};
  for (const key of element.props) {
    const value = raw[key];
    if (value === undefined || value === null || value === '') continue;
    switch (key) {
      case 'color':
      case 'borderBottomColor':
      case 'backgroundColor': {
        const color = normalizeHexColor(value);
        if (color) style[key] = color;
        break;
      }
      case 'fontFamily': {
        if (typeof value === 'string' && value in DOCUMENT_FONTS) style.fontFamily = value as DocumentFontKey;
        break;
      }
      case 'textAlign': {
        if (value === 'left' || value === 'center' || value === 'right') style.textAlign = value;
        break;
      }
      case 'borderBottomStyle': {
        if (value === 'solid' || value === 'dashed' || value === 'dotted' || value === 'none') style.borderBottomStyle = value;
        break;
      }
      case 'visible': {
        if (value === false && element.optional) style.visible = false;
        break;
      }
      default: {
        const n = clampNumber(key, value);
        if (n !== undefined) style[key] = n;
      }
    }
  }
  return Object.keys(style).length > 0 ? style : undefined;
}

/* ---------------------------------------------------------------- rendering */

/** Attribute spread for a tagged element: `<div className="…" {...docEl('rx.header.clinicName')}>`. */
export function docEl(id: string): { 'data-doc-el': string } {
  return { 'data-doc-el': id };
}

/**
 * Declarations for one element. Each declaration carries its own `!important`
 * (a single trailing `!important` would only apply to the last declaration), so
 * an explicit clinic choice always wins over the original stylesheet — the
 * `@media print` block and the compact table variants included — without the
 * base rules having to be changed.
 */
function cssDeclarations(style: DocumentElementStyle): string {
  const parts: string[] = [];
  const px = (n: number) => `${n}px`;
  const add = (property: string, value: string) => parts.push(`${property}: ${value} !important`);
  if (style.visible === false) add('display', 'none');
  if (style.color) add('color', style.color);
  if (style.backgroundColor) add('background-color', style.backgroundColor);
  if (style.fontSize !== undefined) add('font-size', px(style.fontSize));
  if (style.fontWeight !== undefined) add('font-weight', String(style.fontWeight));
  if (style.fontFamily) add('font-family', DOCUMENT_FONTS[style.fontFamily].stack);
  if (style.textAlign) add('text-align', style.textAlign);
  if (style.lineHeight !== undefined) add('line-height', String(style.lineHeight));
  if (style.letterSpacing !== undefined) add('letter-spacing', px(style.letterSpacing));
  if (style.marginTop !== undefined) add('margin-top', px(style.marginTop));
  if (style.marginRight !== undefined) add('margin-right', px(style.marginRight));
  if (style.marginBottom !== undefined) add('margin-bottom', px(style.marginBottom));
  if (style.marginLeft !== undefined) add('margin-left', px(style.marginLeft));
  if (style.paddingTop !== undefined) add('padding-top', px(style.paddingTop));
  if (style.paddingRight !== undefined) add('padding-right', px(style.paddingRight));
  if (style.paddingBottom !== undefined) add('padding-bottom', px(style.paddingBottom));
  if (style.paddingLeft !== undefined) add('padding-left', px(style.paddingLeft));
  if (style.borderBottomWidth !== undefined) add('border-bottom-width', px(style.borderBottomWidth));
  if (style.borderBottomStyle) add('border-bottom-style', style.borderBottomStyle);
  if (style.borderBottomColor) add('border-bottom-color', style.borderBottomColor);
  if (style.width !== undefined) add('width', px(style.width));
  if (style.columnWidth !== undefined) add('width', `${style.columnWidth}%`);
  return parts.join('; ');
}

/**
 * CSS for the stored overrides. Produces an empty string when nothing is
 * customized — that is the guarantee that an untouched document is unchanged.
 *
 * Each declaration is emitted with `!important` so an explicit clinic choice
 * wins over the original stylesheet (including the `@media print` block and the
 * compact table variants) without any base rule having to be rewritten.
 */
export function documentStyleCss(styles: DocumentStyleMap | undefined | null): string {
  if (!styles) return '';
  const rules: string[] = [];
  for (const def of DOCUMENT_TYPE_DEFS) {
    const overrides = styles[def.type];
    if (!overrides) continue;
    for (const element of def.elements) {
      const style = overrides[element.id];
      if (!style) continue;
      const declarations = cssDeclarations(style);
      if (!declarations) continue;
      const suffix = element.descendant ? ` ${element.descendant}` : '';
      rules.push(`.print-doc [data-doc-el="${element.id}"]${suffix} { ${declarations}; }`);
    }
  }
  return rules.join('\n');
}

/** Current overrides for one element (used by the editor and preview). */
export function styleOverride(
  styles: DocumentStyleMap | undefined | null,
  type: CustomizableDocumentType,
  elementId: string,
): DocumentElementStyle | undefined {
  return styles?.[type]?.[elementId];
}

/* ------------------------------------------------------------------ resets */

export function resetElement(styles: DocumentStyleMap, type: CustomizableDocumentType, elementId: string): DocumentStyleMap {
  const next: DocumentStyleMap = { ...styles, [type]: { ...(styles[type] ?? {}) } };
  delete next[type]![elementId];
  if (Object.keys(next[type]!).length === 0) delete next[type];
  return next;
}

export function resetSection(styles: DocumentStyleMap, type: CustomizableDocumentType, section: DocumentSection): DocumentStyleMap {
  let next: DocumentStyleMap = styles;
  for (const element of elementsOf(type, section)) next = resetElement(next, type, element.id);
  return next;
}

export function resetDocument(styles: DocumentStyleMap, type: CustomizableDocumentType): DocumentStyleMap {
  const next: DocumentStyleMap = { ...styles };
  delete next[type];
  return next;
}

export function resetAllDocuments(): DocumentStyleMap {
  return {};
}

/** Number of stored overrides for a document type (used for the UI summary). */
export function countDocumentOverrides(styles: DocumentStyleMap | undefined | null, type: CustomizableDocumentType): number {
  return Object.keys(styles?.[type] ?? {}).length;
}

/** Documents that currently have at least one override. */
export function customizedDocumentTypes(styles: DocumentStyleMap | undefined | null): CustomizableDocumentType[] {
  return DOCUMENT_TYPE_DEFS.map((d) => d.type).filter((type) => countDocumentOverrides(styles, type) > 0);
}
