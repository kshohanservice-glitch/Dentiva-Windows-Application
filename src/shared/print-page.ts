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
 * Legacy page-size markers. They are matched only so that stored settings and
 * saved profiles written by older releases (< 4.3.0) can be detected and
 * removed; nothing in the product produces or accepts them any more.
 */
const LEGACY_NON_A4_SIZE = /(^|[^a-z])(a5|b5|letter|legal|folio|tabloid|thermal|custom)([^a-z]|$)/i;

/** True when a stored profile describes something other than an A4 sheet. */
export function isLegacyNonA4Profile(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const raw = value as Record<string, unknown>;
  const paperSize = String(raw.paperSize ?? '').trim().toLowerCase();
  if (paperSize && paperSize !== 'a4') return true;
  // A custom geometry narrower than a landscape A4 half-sheet (e.g. the retired
  // 80mm receipt roll, 148mm A5, 100mm label sheet) cannot be an A4 document.
  const width = Number(raw.widthMm);
  const height = Number(raw.heightMm);
  if (Number.isFinite(width) && width > 0 && width < A4_WIDTH_MM / 2) return true;
  if (Number.isFinite(height) && height > 0 && height < A4_HEIGHT_MM / 2) return true;
  return LEGACY_NON_A4_SIZE.test(String(raw.name ?? ''));
}

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

/**
 * Normalize a stored profile list: legacy non-A4 profiles are dropped, ids are
 * de-duplicated, the list is capped at 30 and every surviving profile is A4.
 * The result is identical for an upgraded installation and a fresh one.
 */
export function normalizePrintProfiles(value: unknown): PrintProfile[] {
  const list = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const out: PrintProfile[] = [];
  list.forEach((entry, index) => {
    // A non-object entry is junk (not a profile): never turn it into one.
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
    if (isLegacyNonA4Profile(entry)) return;
    const profile = normalizePrintProfile(entry, index);
    if (seen.has(profile.id)) return;
    seen.add(profile.id);
    out.push(profile);
  });
  return out.slice(0, 30);
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
      out.push({ ...fallback, margins: { ...fallback.margins } });
    }
  }
  return out;
}
