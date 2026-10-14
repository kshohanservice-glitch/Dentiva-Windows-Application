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

/** Minimal shape shared by print profiles without coupling settings to rendering. */
export interface PrintPageProfileLike {
  documentType?: string;
  paperSize?: string;
  widthMm?: number;
  heightMm?: number;
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
const A4: DocumentPageSize = { widthMm: 210, heightMm: 297 };
const PAPER_SIZES: Record<string, DocumentPageSize> = {
  a4: A4,
  a5: { widthMm: 148, heightMm: 210 },
  custom: A4,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Normalize old, missing, or hand-edited settings JSON without throwing. */
export function normalizeDocumentWatermark(value: unknown): DocumentWatermarkSettings {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const size = Number(raw.sizePercent);
  const opacity = Number(raw.opacity);
  return {
    enabled: raw.enabled === true,
    sizePercent: Number.isFinite(size)
      ? clamp(size, MIN_SIZE_PERCENT, MAX_SIZE_PERCENT)
      : DEFAULT_DOCUMENT_WATERMARK.sizePercent,
    opacity: Number.isFinite(opacity)
      ? clamp(opacity, MIN_OPACITY, MAX_OPACITY)
      : DEFAULT_DOCUMENT_WATERMARK.opacity,
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

/** Apply print-profile orientation to actual physical page coordinates. */
export function pageSizeFromProfile(profile?: PrintPageProfileLike | null): DocumentPageSize {
  if (!profile) return { ...A4 };
  const base = PAPER_SIZES[String(profile.paperSize ?? '').toLowerCase()] ?? A4;
  const widthMm = Number.isFinite(Number(profile.widthMm)) && Number(profile.widthMm) > 0
    ? Number(profile.widthMm)
    : base.widthMm;
  const heightMm = Number.isFinite(Number(profile.heightMm)) && Number(profile.heightMm) > 0
    ? Number(profile.heightMm)
    : base.heightMm;
  return profile.orientation === 'landscape'
    ? { widthMm: heightMm, heightMm: widthMm }
    : { widthMm, heightMm };
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
