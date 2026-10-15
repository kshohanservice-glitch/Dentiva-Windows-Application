import type { PrintProfile } from './types';

/**
 * A4 is the only document page size Dentiva Pro supports.
 *
 * Every printable artefact — invoice, receipt, prescription (including the
 * duplicate copy), visit summary, appointment card, treatment plan, referral,
 * report, walk-in/quick document and stock-label sheet — is paginated on A4,
 * portrait or landscape. There is no other page size anywhere in the product:
 * one constant set here is the single source of truth used by the print window,
 * the print/PDF path, the print-profile settings, the watermark geometry and
 * the tests. See docs/PRINTING.md ("A4-only document policy").
 */

export const A4_WIDTH_MM = 210;
export const A4_HEIGHT_MM = 297;

/** User-facing description of the (only) supported page size. */
export const A4_PAGE_LABEL = 'A4 · 210 × 297 mm';

export const PRINT_DOCUMENT_TYPES = ['prescription', 'invoice', 'report', 'receipt'] as const;
export type PrintDocumentType = (typeof PRINT_DOCUMENT_TYPES)[number];

export const DEFAULT_PRINT_MARGINS_MM = Object.freeze({ top: 12, right: 12, bottom: 12, left: 12 });

export interface DocumentPageGeometry {
  widthMm: number;
  heightMm: number;
}

/** The oriented A4 page box in millimetres (landscape swaps the axes). */
export function a4PageSize(orientation: 'portrait' | 'landscape' = 'portrait'): DocumentPageGeometry {
  return orientation === 'landscape'
    ? { widthMm: A4_HEIGHT_MM, heightMm: A4_WIDTH_MM }
    : { widthMm: A4_WIDTH_MM, heightMm: A4_HEIGHT_MM };
}

/** How far a requested page box may deviate from A4 and still count as A4 (mm). */
export const A4_SIZE_TOLERANCE_MM = 1;

/**
 * Resolve a *requested* page box to the A4 policy.
 *
 * The main-process print and Save-as-PDF calls take their geometry from the
 * renderer, so this is the boundary where the policy is enforced: an A4
 * portrait or landscape box keeps its orientation, and anything else — a
 * legacy A5/thermal request from an older or tampered renderer, junk, or no
 * value at all — prints A4 portrait. The document's own `@page` rule comes from
 * the same module, so the CSS and the native page box always agree.
 */
export function asA4PageSize(widthMm?: unknown, heightMm?: unknown): DocumentPageGeometry {
  const width = Number(widthMm);
  const height = Number(heightMm);
  const near = (a: number, b: number) => Math.abs(a - b) <= A4_SIZE_TOLERANCE_MM;
  if (Number.isFinite(width) && Number.isFinite(height)) {
    if (near(width, A4_WIDTH_MM) && near(height, A4_HEIGHT_MM)) return a4PageSize('portrait');
    if (near(width, A4_HEIGHT_MM) && near(height, A4_WIDTH_MM)) return a4PageSize('landscape');
  }
  return a4PageSize('portrait');
}

/**
 * The single `@page` rule for every printable document. The document element
 * carries the profile margins as padding, so the page itself has zero native
 * margin and the on-screen preview and the physical/PDF page share one
 * coordinate system.
 */
export function a4PageCss(orientation: 'portrait' | 'landscape' = 'portrait'): string {
  const { widthMm, heightMm } = a4PageSize(orientation);
  return `@page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }`;
}

/**
 * Legacy page-size handling (v5, V5-022 / V5-023).
 *
 * Releases before 5.0 stored a page size in each print profile (`paperSize`
 * a4 | a5 | custom | thermal, plus `widthMm` / `heightMm`). A profile is
 * *legacy* only when its stored **geometry** says it is not an A4 sheet — the
 * profile name is never used for that decision, so a clinic's own A4 profile
 * called, say, "Custom letterhead" can never be mistaken for one.
 *
 * Legacy profiles are converted, not deleted, because they carry a clinic's
 * printing choices:
 *  - page-like media (A5, Letter, Legal, a custom page): the printer,
 *    orientation, margins, scale and copies are kept;
 *  - roll and label media (thermal rolls, anything narrower than 120 mm):
 *    copies and orientation are kept, but the printer is cleared (a receipt
 *    printer cannot print A4) and margins/scale fall back to the A4 defaults;
 *  - the two profiles older releases seeded and the clinic never changed
 *    (`rx-a5` "Prescription A5", `inv-thermal` "Receipt Thermal 80mm") carry no
 *    customization and are dropped; the document type keeps its A4 default.
 */
const A4_SIZE_KEYS = new Set(['', 'a4']);
const ROLL_SIZE_KEYS = new Set(['thermal', 'roll', 'receipt', 'label']);
/** Media narrower or shorter than this (mm) are rolls/labels, never pages. */
const MIN_PAGE_EDGE_MM = 120;

const LEGACY_SEEDS: readonly Record<string, unknown>[] = Object.freeze([
  { id: 'rx-a5', name: 'Prescription A5', documentType: 'prescription', printerName: '', paperSize: 'a5', orientation: 'portrait', margins: { top: 8, right: 8, bottom: 8, left: 8 }, scale: 100, copies: 1 },
  { id: 'inv-thermal', name: 'Receipt Thermal 80mm', documentType: 'receipt', printerName: '', paperSize: 'thermal', orientation: 'portrait', margins: { top: 4, right: 4, bottom: 4, left: 4 }, scale: 100, copies: 1 },
]);

function finiteMm(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** True when a stored profile's geometry describes something other than an A4 sheet. */
export function isLegacyNonA4Profile(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const raw = value as Record<string, unknown>;
  const paperSize = String(raw.paperSize ?? '').trim().toLowerCase();
  if (!A4_SIZE_KEYS.has(paperSize)) return true;
  const width = finiteMm(raw.widthMm);
  const height = finiteMm(raw.heightMm);
  if (width === null || height === null) return false; // no explicit geometry: an A4 profile
  const near = (a: number, b: number) => Math.abs(a - b) <= A4_SIZE_TOLERANCE_MM;
  const isA4 = (near(width, A4_WIDTH_MM) && near(height, A4_HEIGHT_MM)) || (near(width, A4_HEIGHT_MM) && near(height, A4_WIDTH_MM));
  return !isA4;
}

/** The stored medium of a legacy profile, described for people (audit, names). */
export function legacyMediumLabel(value: unknown): string {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const paperSize = String(raw.paperSize ?? '').trim().toLowerCase();
  const width = finiteMm(raw.widthMm);
  const height = finiteMm(raw.heightMm);
  const dims = width && height ? ` ${Math.round(width)} × ${Math.round(height)} mm` : '';
  if (paperSize === 'thermal') return `thermal${width ? ` ${Math.round(width)} mm` : ''} roll`;
  if (!paperSize || paperSize === 'custom' || paperSize === 'a4') return `custom${dims}`;
  return paperSize.toUpperCase();
}

function isRollOrLabel(raw: Record<string, unknown>): boolean {
  const paperSize = String(raw.paperSize ?? '').trim().toLowerCase();
  if (ROLL_SIZE_KEYS.has(paperSize)) return true;
  const width = finiteMm(raw.widthMm);
  const height = finiteMm(raw.heightMm);
  return (width !== null && width < MIN_PAGE_EDGE_MM) || (height !== null && height < MIN_PAGE_EDGE_MM);
}

function sameMargins(a: unknown, b: unknown): boolean {
  const x = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>;
  const y = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>;
  return ['top', 'right', 'bottom', 'left'].every((k) => Number(x[k]) === Number(y[k]));
}

/** An older release's seeded legacy profile that the clinic never changed. */
export function isUntouchedLegacySeed(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const raw = value as Record<string, unknown>;
  return LEGACY_SEEDS.some((seed) =>
    raw.id === seed.id && raw.name === seed.name && raw.documentType === seed.documentType &&
    String(raw.printerName ?? '') === seed.printerName &&
    String(raw.paperSize ?? '').toLowerCase() === seed.paperSize &&
    (raw.orientation ?? 'portrait') === seed.orientation &&
    sameMargins(raw.margins, seed.margins) &&
    Number(raw.scale ?? 100) === seed.scale && Number(raw.copies ?? 1) === seed.copies,
  );
}

const SIZE_WORDS = /\b(a5|b5|letter|legal|folio|tabloid|thermal|roll|custom)\b/gi;
const SIZE_DIMENSIONS = /\b\d{2,4}\s*(?:mm)?\s*(?:[x×]\s*\d{2,4}\s*)?mm\b/gi;

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

function trimmedString(value: unknown, max: number, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const text = value.trim();
  if (!text) return fallback;
  return text.slice(0, max);
}

/**
 * Coerce any stored/legacy profile into the A4-only shape.
 *
 * The page size is *not* a field of the result: an A4 print profile only
 * describes who prints it and how (printer, orientation, margins, scale,
 * copies). Unknown properties — including every legacy `paperSize`, `widthMm`
 * and `heightMm` — are dropped, so a hand-edited or half-migrated settings row
 * can never reintroduce another page size. Never throws.
 */
export function normalizePrintProfile(value: unknown, index = 0): PrintProfile {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const documentType = PRINT_DOCUMENT_TYPES.includes(raw.documentType as PrintDocumentType)
    ? raw.documentType as PrintDocumentType
    : 'invoice';
  const margins = raw.margins && typeof raw.margins === 'object' && !Array.isArray(raw.margins)
    ? raw.margins as Record<string, unknown>
    : {};
  return {
    id: trimmedString(raw.id, 60, `profile-${index + 1}`),
    name: trimmedString(raw.name, 80, `Profile ${index + 1}`),
    documentType,
    printerName: typeof raw.printerName === 'string' ? raw.printerName.slice(0, 200) : '',
    orientation: raw.orientation === 'landscape' ? 'landscape' : 'portrait',
    margins: {
      top: clampNumber(margins.top, 0, 50, DEFAULT_PRINT_MARGINS_MM.top),
      right: clampNumber(margins.right, 0, 50, DEFAULT_PRINT_MARGINS_MM.right),
      bottom: clampNumber(margins.bottom, 0, 50, DEFAULT_PRINT_MARGINS_MM.bottom),
      left: clampNumber(margins.left, 0, 50, DEFAULT_PRINT_MARGINS_MM.left),
    },
    scale: clampNumber(raw.scale, 50, 200, 100),
    copies: Math.round(clampNumber(raw.copies, 1, 10, 1)),
  };
}

const DOCUMENT_LABELS: Record<PrintDocumentType, string> = {
  prescription: 'Prescription', invoice: 'Invoice', report: 'Report', receipt: 'Receipt',
};

/** Convert one legacy (non-A4) profile to A4, keeping the choices that still apply. */
function convertLegacyProfile(raw: Record<string, unknown>, index: number): { profile: PrintProfile; printerCleared: boolean } {
  const roll = isRollOrLabel(raw);
  const base = normalizePrintProfile(raw, index);
  // The new name never repeats the retired medium (the audit entry records it):
  // "Prescription A5" → "Prescription A4 (converted)".
  const stem = String(raw.name ?? '').replace(SIZE_DIMENSIONS, ' ').replace(SIZE_WORDS, ' ').replace(/\bA4\b/gi, ' ').replace(/\s+/g, ' ').trim()
    || DOCUMENT_LABELS[base.documentType];
  const name = `${stem.slice(0, 60)} A4 (converted)`;
  const printerCleared = roll && base.printerName !== '';
  return {
    profile: {
      ...base,
      name,
      printerName: roll ? '' : base.printerName,
      margins: roll ? { ...DEFAULT_PRINT_MARGINS_MM } : base.margins,
      scale: roll ? 100 : base.scale,
    },
    printerCleared,
  };
}

/** What happened to each stored profile when it was brought to the A4 model. */
export interface PrintProfilePlan {
  profiles: PrintProfile[];
  kept: string[];
  converted: { from: string; to: string; medium: string; printerCleared: boolean }[];
  droppedSeeds: string[];
  droppedInvalid: number;
}

/**
 * Bring a stored profile list to the A4 model. A4 profiles are kept (with their
 * customization); legacy profiles are converted (ids and names lose retired
 * size markers, ids stay unique); untouched legacy seeds and junk entries are
 * dropped; the list is capped at 30. Never throws.
 */
export function planPrintProfiles(value: unknown): PrintProfilePlan {
  const list = Array.isArray(value) ? value : [];
  const plan: PrintProfilePlan = { profiles: [], kept: [], converted: [], droppedSeeds: [], droppedInvalid: 0 };
  const ids = new Set<string>();
  const names = new Set<string>();
  const uniqueName = (wanted: string): string => {
    let name = wanted;
    for (let n = 2; names.has(name.toLowerCase()); n += 1) name = `${wanted.replace(/\)$/, '')} ${n})`.slice(0, 80);
    return name;
  };
  // Existing A4 profile ids/names and the canonical default ids are reserved
  // first, so a converted profile never takes an identity that is already in
  // use or that a default profile may need later (withRequiredProfiles).
  const reservedIds = new Set<string>(CANONICAL_IDS);
  list.forEach((entry, index) => {
    if (entry && typeof entry === 'object' && !Array.isArray(entry) && !isLegacyNonA4Profile(entry)) {
      const p = normalizePrintProfile(entry, index);
      reservedIds.add(p.id);
      names.add(p.name.toLowerCase());
    }
  });
  const uniqueConvertedId = (wanted: string): string => {
    let id = wanted;
    for (let n = 2; ids.has(id) || reservedIds.has(id); n += 1) id = `${wanted}-${n}`.slice(0, 60);
    return id;
  };
  list.forEach((entry, index) => {
    // A non-object entry is junk (not a profile): never turn it into one.
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { plan.droppedInvalid += 1; return; }
    const raw = entry as Record<string, unknown>;
    if (isLegacyNonA4Profile(raw)) {
      if (isUntouchedLegacySeed(raw)) { plan.droppedSeeds.push(String(raw.id)); return; }
      const { profile, printerCleared } = convertLegacyProfile(raw, index);
      const cleanId = profile.id.replace(SIZE_WORDS, 'a4');
      const id = uniqueConvertedId(cleanId);
      ids.add(id);
      const name = uniqueName(profile.name);
      names.add(name.toLowerCase());
      plan.profiles.push({ ...profile, id, name });
      plan.converted.push({ from: String(raw.id ?? ''), to: id, medium: legacyMediumLabel(raw), printerCleared });
      return;
    }
    const profile = normalizePrintProfile(raw, index);
    if (ids.has(profile.id)) { plan.droppedInvalid += 1; return; }
    ids.add(profile.id);
    plan.profiles.push(profile);
    plan.kept.push(profile.id);
  });
  plan.profiles = plan.profiles.slice(0, 30);
  return plan;
}

/** Normalize a stored profile list to the A4 model (see planPrintProfiles). */
export function normalizePrintProfiles(value: unknown): PrintProfile[] {
  return planPrintProfiles(value).profiles;
}

/**
 * The authoritative profile set for a clinic that has not customized printing:
 * one A4 profile per supported document type, so no document has to borrow
 * another type's margins. IDs are stable (`rx-a4`, `inv-a4`, `rc-a4`, `rp-a4`)
 * because they are stored in settings and referenced by the print window's
 * `?profile=` parameter.
 */
const CANONICAL_PRINT_PROFILES: readonly PrintProfile[] = Object.freeze([
  { id: 'rx-a4', name: 'Prescription A4', documentType: 'prescription', printerName: '', orientation: 'portrait', margins: { ...DEFAULT_PRINT_MARGINS_MM }, scale: 100, copies: 1 },
  { id: 'inv-a4', name: 'Invoice A4', documentType: 'invoice', printerName: '', orientation: 'portrait', margins: { ...DEFAULT_PRINT_MARGINS_MM }, scale: 100, copies: 1 },
  { id: 'rc-a4', name: 'Receipt A4', documentType: 'receipt', printerName: '', orientation: 'portrait', margins: { ...DEFAULT_PRINT_MARGINS_MM }, scale: 100, copies: 1 },
  { id: 'rp-a4', name: 'Report A4', documentType: 'report', printerName: '', orientation: 'portrait', margins: { ...DEFAULT_PRINT_MARGINS_MM }, scale: 100, copies: 1 },
].map((profile) => Object.freeze({ ...profile, margins: Object.freeze({ ...profile.margins }) }) as PrintProfile));

export const DEFAULT_PRINT_PROFILES: readonly PrintProfile[] = CANONICAL_PRINT_PROFILES;

/** Stable ids of the default A4 profiles (referenced by `?profile=`). */
const CANONICAL_IDS: readonly string[] = CANONICAL_PRINT_PROFILES.map((profile) => profile.id);

/** Fresh, mutable copies of the defaults (callers persist and edit them). */
export function defaultPrintProfiles(): PrintProfile[] {
  return CANONICAL_PRINT_PROFILES.map((profile) => ({ ...profile, margins: { ...profile.margins } }));
}

/**
 * Ensure every document type has a profile. Used when reading stored settings so
 * a clinic that upgraded from a release with different defaults (or emptied a
 * type) still prints each document with its own A4 profile.
 */
export function withRequiredProfiles(profiles: readonly PrintProfile[]): PrintProfile[] {
  const out = profiles.map((profile) => ({ ...profile, margins: { ...profile.margins } }));
  for (const fallback of CANONICAL_PRINT_PROFILES) {
    if (!out.some((profile) => profile.documentType === fallback.documentType)) {
      // Never duplicate an id that is already taken by another profile.
      let id = fallback.id;
      for (let n = 2; out.some((profile) => profile.id === id); n += 1) id = `${fallback.id}-${n}`;
      out.push({ ...fallback, id, margins: { ...fallback.margins } });
    }
  }
  return out;
}
