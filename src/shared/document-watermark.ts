import { a4PageSize } from './print-page';

/** Optional clinic-logo watermark configuration for printable documents. */
export interface DocumentWatermarkSettings {
  /** Off by default: existing print output is unchanged until explicitly enabled. */
  enabled: boolean;
  /** Maximum logo dimension as a percentage of the printable page's shorter edge. */
  sizePercent: number;
  /** CSS opacity fraction, bounded to remain a subtle background mark. */
  opacity: number;
}

export interface DocumentPageSize {
  widthMm: number;
  heightMm: number;
}

/**
 * Minimal shape shared by print profiles without coupling settings to rendering.
 * There is no paper size here on purpose: A4 is the only document page size and
 * the orientation is the only geometry a profile can influence.
 */
export interface PrintPageProfileLike {
  documentType?: string;
  orientation?: string;
}

export const DEFAULT_DOCUMENT_WATERMARK: Readonly<DocumentWatermarkSettings> = Object.freeze({
  enabled: false,
  sizePercent: 40,
  opacity: 0.12,
});

export const WATERMARK_ELIGIBLE_DOCUMENT_TYPES = [
  'prescription',
  'invoice',
  'visit-summary',
  'appointment-card',
  'report',
] as const;

const MIN_SIZE_PERCENT = 15;
const MAX_SIZE_PERCENT = 70;
const MIN_OPACITY = 0.04;
const MAX_OPACITY = 0.3;
const A4: DocumentPageSize = a4PageSize('portrait');

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Read a bounded numeric setting. Only a real, finite number counts: `null`,
 * `''`, `false`, arrays and numeric strings are *missing* values, not zeros, so
 * a hand-edited or half-migrated settings row falls back to the documented
 * default instead of silently becoming the smallest watermark (0 would clamp up
 * to the minimum).
 */
function numericSetting(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Normalize old, missing, or hand-edited settings JSON without throwing. */
export function normalizeDocumentWatermark(value: unknown): DocumentWatermarkSettings {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const size = numericSetting(raw.sizePercent);
  const opacity = numericSetting(raw.opacity);
  return {
    enabled: raw.enabled === true,
    sizePercent: size === null
      ? DEFAULT_DOCUMENT_WATERMARK.sizePercent
      : clamp(size, MIN_SIZE_PERCENT, MAX_SIZE_PERCENT),
    opacity: opacity === null
      ? DEFAULT_DOCUMENT_WATERMARK.opacity
      : clamp(opacity, MIN_OPACITY, MAX_OPACITY),
  };
}

/**
 * Max bounds for the image in physical page units. CSS constrains both axes
 * without setting an image width/height, so the configured logo's aspect ratio
 * remains intrinsic and the result is independent of screen zoom or viewport.
 */
export function watermarkImageBounds(
  page: DocumentPageSize,
  sizePercent: number,
): { maxWidthMm: number; maxHeightMm: number } {
  const width = Number.isFinite(page.widthMm) && page.widthMm > 0 ? page.widthMm : A4.widthMm;
  const height = Number.isFinite(page.heightMm) && page.heightMm > 0 ? page.heightMm : A4.heightMm;
  const percent = Number.isFinite(sizePercent)
    ? clamp(sizePercent, MIN_SIZE_PERCENT, MAX_SIZE_PERCENT)
    : DEFAULT_DOCUMENT_WATERMARK.sizePercent;
  const longestLogoDimensionMm = Math.min(width, height) * percent / 100;
  return { maxWidthMm: longestLogoDimensionMm, maxHeightMm: longestLogoDimensionMm };
}

/** Receipts and compact stock labels are intentionally excluded for legibility. */
export function supportsLogoWatermark(documentType: string | null | undefined): boolean {
  if (!documentType) return false;
  const normalized = documentType.startsWith('quick-')
    ? documentType.slice('quick-'.length)
    : documentType === 'prescription-duplicate'
      ? 'prescription'
      : documentType;
  return (WATERMARK_ELIGIBLE_DOCUMENT_TYPES as readonly string[]).includes(normalized);
}

/**
 * Physical page coordinates of a document: the oriented A4 box. A profile can
 * only choose the orientation — every document is A4 (see src/shared/print-page.ts).
 */
export function pageSizeFromProfile(profile?: PrintPageProfileLike | null): DocumentPageSize {
  return a4PageSize(profile?.orientation === 'landscape' ? 'landscape' : 'portrait');
}

/** Find the document's configured profile for matching screen previews. */
export function pageSizeForDocument(
  profiles: readonly PrintPageProfileLike[] | null | undefined,
  documentType: string,
): DocumentPageSize {
  const normalizedType = documentType.startsWith('quick-')
    ? documentType.slice('quick-'.length)
    : documentType === 'prescription-duplicate'
      ? 'prescription'
      : documentType;
  const profile = profiles?.find((candidate) => candidate.documentType === normalizedType);
  return pageSizeFromProfile(profile);
}
