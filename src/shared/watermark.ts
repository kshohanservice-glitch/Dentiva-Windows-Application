/**
 * Clinic-logo watermark for printable documents (Settings → Customize Documents).
 *
 * Design rules
 * ------------
 * 1. **Disabled by default.** An installation that changes nothing prints
 *    exactly the documents it printed before this setting existed.
 * 2. **Page geometry, not screen geometry.** The watermark is sized from the
 *    real page dimensions of the selected print profile (millimetres), so the
 *    same setting produces the same placement on A4, A5 and custom paper, in
 *    portrait or landscape, and never depends on the window width, the preview
 *    zoom or a hard-coded offset.
 * 3. **Aspect ratio is preserved.** The logo is fitted inside a box that is
 *    `sizePercent` of the page width and height (`object-fit: contain`), so a
 *    wide or a very tall logo is scaled to fit and never stretched.
 * 4. **Behind the content.** The layer is painted under the document text
 *    (see `.print-watermark-layer` in `styles/print.css`), so patient details,
 *    tables, totals and signatures stay fully legible.
 * 5. **Graceful without a logo.** No logo (or an unreadable logo) means no
 *    watermark — never a broken image or a failed document.
 * 6. **Deliberate exclusions.** The compact stock/expiry label sheet keeps its
 *    label layout and never carries the watermark.
 *
 * Everything in this module is pure so the geometry and validation can be
 * unit-tested without Electron, a printer or a display.
 */

export interface WatermarkSettings {
  /** Master switch. `false` (the default) disables the watermark everywhere. */
  enabled: boolean;
  /**
   * Watermark box size as a percentage of the page width and of the page
   * height. The logo is scaled *inside* that box, keeping its aspect ratio.
   */
  sizePercent: number;
  /** Opacity applied to the logo only — never to the document content. */
  opacity: number;
}

export const WATERMARK_DEFAULT: WatermarkSettings = {
  enabled: false,
  sizePercent: 55,
  opacity: 0.08,
};

export const WATERMARK_LIMITS = {
  /** Below 10 % the mark is invisible; above 100 % it would leave the page. */
  sizePercent: { min: 10, max: 100, step: 5 },
  /** 0.50 is already strong enough to reduce legibility; 0.02 is a faint tint. */
  opacity: { min: 0.02, max: 0.5, step: 0.01 },
} as const;

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  // A missing or non-numeric value falls back to the documented default (which
  // is the conservative choice: an unreadable setting must not turn into a
  // very faint or an oversized mark). A number outside the allowed range is
  // clamped, because the operator clearly meant "as large/faint as possible".
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/**
 * Validate untrusted watermark input (settings JSON, IPC payload, hand-edited
 * row) into a canonical configuration. Never throws: an invalid value falls back
 * to the documented default for that field, so a corrupt settings row degrades
 * to "no watermark" instead of breaking document rendering.
 */
export function normalizeWatermarkSettings(raw: unknown): WatermarkSettings {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    enabled: source.enabled === true,
    sizePercent: Math.round(clamp(source.sizePercent, WATERMARK_LIMITS.sizePercent.min, WATERMARK_LIMITS.sizePercent.max, WATERMARK_DEFAULT.sizePercent)),
    opacity: Math.round(clamp(source.opacity, WATERMARK_LIMITS.opacity.min, WATERMARK_LIMITS.opacity.max, WATERMARK_DEFAULT.opacity) * 100) / 100,
  };
}

export function watermarkEnabled(settings: WatermarkSettings | null | undefined, logoDataUrl?: string | null): boolean {
  return !!settings?.enabled && !!logoDataUrl;
}

export interface WatermarkBox {
  widthMm: number;
  heightMm: number;
}

/**
 * The watermark box for a page of `pageWidthMm × pageHeightMm`, in millimetres.
 * The box is the same fraction of the page in both directions so the mark stays
 * visually centred and proportional on portrait, landscape and custom paper.
 */
export function watermarkBoxMm(
  settings: WatermarkSettings | null | undefined,
  pageWidthMm: number,
  pageHeightMm: number,
): WatermarkBox {
  const normalized = normalizeWatermarkSettings(settings);
  const width = Number(pageWidthMm);
  const height = Number(pageHeightMm);
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 210;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 297;
  const fraction = normalized.sizePercent / 100;
  return {
    widthMm: Math.round(safeWidth * fraction * 100) / 100,
    heightMm: Math.round(safeHeight * fraction * 100) / 100,
  };
}

/**
 * Printable documents that carry the watermark. Every document type is listed
 * explicitly — a new document kind cannot silently inherit the watermark.
 */
const WATERMARK_DOCUMENT_KINDS: readonly string[] = [
  'prescription',
  'prescription-duplicate',
  'invoice',
  'receipt',
  'visit-summary',
  'appointment-card',
  'report',
  // Walk-in / quick documents print the same templates and therefore follow the
  // same rule as their stored equivalents.
  'quick-prescription',
  'quick-invoice',
  'quick-receipt',
  'quick-visit-summary',
  'quick-appointment-card',
];

/** Document kinds that deliberately never carry the watermark. */
export const WATERMARK_EXCLUDED_KINDS: readonly string[] = ['stock-labels', 'quick-stock-labels'];

export function watermarkAppliesTo(documentKind: string | null | undefined): boolean {
  if (!documentKind) return false;
  return WATERMARK_DOCUMENT_KINDS.includes(documentKind);
}

/** Operator-facing summary of the applicability rule (settings panel + docs). */
export const WATERMARK_SCOPE_NOTE =
  'Applies to prescriptions (including duplicates), invoices, receipts, visit summaries, appointment cards and reports — in both the patient and the walk-in workflows. The compact stock/expiry label sheet is excluded.';
