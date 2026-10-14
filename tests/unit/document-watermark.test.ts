import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DEFAULT_DOCUMENT_WATERMARK, normalizeDocumentWatermark, pageSizeForDocument,
  pageSizeFromProfile, supportsLogoWatermark, watermarkImageBounds,
} from '../../src/shared/document-watermark';
import { ClinicLogoWatermark } from '../../src/renderer/documents/document-preview';

const clinic = { logoDataUrl: 'data:image/png;base64,AA==' };

describe('document watermark settings and geometry', () => {
  it('defaults to disabled and normalizes malformed or out-of-range settings', () => {
    expect(DEFAULT_DOCUMENT_WATERMARK.enabled).toBe(false);
    expect(normalizeDocumentWatermark(undefined)).toEqual({ enabled: false, sizePercent: 40, opacity: 0.12 });
    expect(normalizeDocumentWatermark({ enabled: true, sizePercent: 500, opacity: -1 })).toEqual({
      enabled: true, sizePercent: 70, opacity: 0.04,
    });
    expect(normalizeDocumentWatermark({ enabled: 1, sizePercent: 'bad', opacity: Infinity })).toEqual({
      enabled: false, sizePercent: 40, opacity: 0.12,
    });
  });

  it('uses physical page dimensions and correctly swaps landscape axes', () => {
    expect(pageSizeFromProfile({ paperSize: 'a5', orientation: 'landscape' })).toEqual({ widthMm: 210, heightMm: 148 });
    expect(pageSizeForDocument([
      { documentType: 'prescription', paperSize: 'a5', orientation: 'portrait' },
    ], 'quick-prescription')).toEqual({ widthMm: 148, heightMm: 210 });
    expect(watermarkImageBounds({ widthMm: 210, heightMm: 297 }, 40)).toEqual({ maxWidthMm: 84, maxHeightMm: 84 });
  });

  it('limits the logo watermark to supported documents', () => {
    expect(supportsLogoWatermark('prescription')).toBe(true);
    expect(supportsLogoWatermark('prescription-duplicate')).toBe(true);
    expect(supportsLogoWatermark('quick-visit-summary')).toBe(true);
    expect(supportsLogoWatermark('quick-receipt')).toBe(false);
    expect(supportsLogoWatermark('stock-labels')).toBe(false);
  });

  it('renders a centered, bounded watermark only when enabled and a clinic logo exists', () => {
    const disabled = renderToStaticMarkup(createElement(ClinicLogoWatermark, {
      clinic,
      settings: { enabled: false, sizePercent: 40, opacity: 0.12 },
      documentType: 'prescription',
      pageSize: { widthMm: 210, heightMm: 297 },
    }));
    expect(disabled).toBe('');

    const enabled = renderToStaticMarkup(createElement(ClinicLogoWatermark, {
      clinic,
      settings: { enabled: true, sizePercent: 30, opacity: 0.08 },
      documentType: 'prescription',
      pageSize: { widthMm: 210, heightMm: 297 },
    }));
    expect(enabled).toContain('class="print-logo-watermark"');
    expect(enabled).toContain('max-width:63mm');
    expect(enabled).toContain('max-height:63mm');
    expect(enabled).toContain('opacity:0.08');
    expect(enabled).toContain('data:image/png;base64,AA==');
    expect(enabled).not.toMatch(/<img[^>]*\swidth=/);
    expect(enabled).not.toMatch(/<img[^>]*\sheight=/);

    const withoutLogo = renderToStaticMarkup(createElement(ClinicLogoWatermark, {
      clinic: { logoDataUrl: null },
      settings: { enabled: true, sizePercent: 40, opacity: 0.12 },
      documentType: 'prescription',
    }));
    expect(withoutLogo).toBe('');
  });
});
