import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_DOCUMENT_WATERMARK, normalizeDocumentWatermark, pageSizeForDocument,
  pageSizeFromProfile, supportsLogoWatermark, watermarkImageBounds,
} from '../../src/shared/document-watermark';
import { ClinicLogoWatermark, DocumentPreview } from '../../src/renderer/documents/document-preview';
import { CustomizeDocumentsPanel } from '../../src/renderer/components/customize-documents';
import { ToastProvider } from '../../src/renderer/components/primitives';

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

  it('uses the A4 physical page and correctly swaps landscape axes', () => {
    // A4 is the only document page size: the orientation is the only geometry a
    // profile can influence (see src/shared/print-page.ts).
    expect(pageSizeFromProfile({ orientation: 'landscape' })).toEqual({ widthMm: 297, heightMm: 210 });
    expect(pageSizeForDocument([
      { documentType: 'prescription', orientation: 'landscape' },
    ], 'quick-prescription')).toEqual({ widthMm: 297, heightMm: 210 });
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

describe('clinic-logo watermark layering', () => {
  const css = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'src', 'renderer', 'styles', 'print.css'),
    'utf8',
  );

  /** The declaration block of one exact selector, whitespace-normalized. */
  function rule(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
    expect(match, `missing CSS rule for ${selector}`).not.toBeNull();
    return (match as RegExpExecArray)[1].replace(/\s+/g, ' ').trim();
  }

  it('paints the mark above the page background instead of behind it', () => {
    // A negative z-index would place the mark below the white backgrounds of
    // `.print-stage` / `.print-doc` (and of the print root), which makes it
    // invisible both on screen and on paper — the regression this covers.
    const mark = rule('.print-logo-watermark');
    expect(mark).not.toMatch(/z-index:\s*-/);
    expect(mark).toContain('z-index: 0');
    expect(mark).toContain('position: absolute');
    expect(mark).toContain('inset: 0');
    expect(mark).toContain('pointer-events: none');
  });

  it('keeps printable content above the mark and centers it on the page box', () => {
    const content = rule('.print-doc-content');
    expect(content).toContain('position: relative');
    expect(content).toMatch(/z-index:\s*1\b/);
    // The mark itself is centered in its box, which is the whole page.
    const mark = rule('.print-logo-watermark');
    expect(mark).toContain('align-items: center');
    expect(mark).toContain('justify-content: center');
    // …and the page box is the mark's positioning context.
    expect(rule('.print-doc')).toContain('position: relative');
  });

  it('repeats the mark page-centered on every printed sheet', () => {
    // Every `.print-logo-watermark` declaration block in the stylesheet: the
    // base (screen preview / page box) rule and the print-media override.
    const blocks = Array.from(css.matchAll(/\.print-logo-watermark\s*\{([^}]*)\}/g))
      .map((match) => match[1].replace(/\s+/g, ' ').trim());
    expect(blocks).toHaveLength(2);
    const printed = blocks.find((block) => block.includes('position: fixed'));
    expect(printed, 'no print-media rule keeps the mark on every sheet').toBeDefined();
    expect(printed).toContain('inset: 0');
    expect(printed).not.toMatch(/z-index:\s*-/);
    for (const block of blocks) expect(block).not.toMatch(/z-index:\s*-/);
  });
});

describe('preview composition keeps the mark behind the document body', () => {
  it('renders the watermark before a dedicated, raised content layer', () => {
    const html = renderToStaticMarkup(createElement(
      DocumentPreview,
      {
        clinic: { logoDataUrl: 'data:image/png;base64,AA==' },
        watermark: { enabled: true, sizePercent: 30, opacity: 0.08 },
        documentType: 'prescription',
        pageSize: { widthMm: 210, heightMm: 297 },
        children: createElement('p', null, 'Patient body text'),
      },
    ));
    const markIndex = html.indexOf('print-logo-watermark');
    const contentIndex = html.indexOf('print-doc-content');
    expect(markIndex).toBeGreaterThan(-1);
    expect(contentIndex).toBeGreaterThan(markIndex);
    expect(html).toContain('Patient body text');
    // The body text lives inside the raised layer, not beside the mark.
    expect(html.slice(contentIndex)).toContain('Patient body text');
  });

  it('omits both the mark and its layer styling when the watermark is off', () => {
    const html = renderToStaticMarkup(createElement(
      DocumentPreview,
      {
        clinic: { logoDataUrl: 'data:image/png;base64,AA==' },
        watermark: { enabled: false, sizePercent: 30, opacity: 0.08 },
        documentType: 'prescription',
        pageSize: { widthMm: 210, heightMm: 297 },
        children: createElement('p', null, 'Patient body text'),
      },
    ));
    expect(html).not.toContain('print-logo-watermark');
    expect(html).toContain('print-doc-content');
  });
});

describe('watermark setting normalization edge cases', () => {
  it('falls back for values that are not real numbers', () => {
    for (const value of [null, undefined, '', 'x', [], {}, true, NaN]) {
      expect(normalizeDocumentWatermark(value)).toEqual({ enabled: false, sizePercent: 40, opacity: 0.12 });
    }
  });

  it('treats a missing or non-numeric field as the default, never as zero', () => {
    // `Number(null) === 0` used to clamp a corrupt `opacity: null` down to the
    // minimum watermark instead of the documented default.
    const expected = { enabled: true, sizePercent: 40, opacity: 0.12 };
    for (const malformed of [
      { enabled: true, sizePercent: null, opacity: null },
      { enabled: true, sizePercent: '', opacity: '' },
      { enabled: true, sizePercent: '60', opacity: '0.2' },
      { enabled: true, sizePercent: [], opacity: {} },
      { enabled: true, sizePercent: false, opacity: false },
    ]) {
      expect(normalizeDocumentWatermark(malformed), JSON.stringify(malformed)).toEqual(expected);
    }
    // Real numbers still clamp into the supported window.
    expect(normalizeDocumentWatermark({ enabled: true, sizePercent: 0, opacity: 0 }))
      .toEqual({ enabled: true, sizePercent: 15, opacity: 0.04 });
  });

  it('only the boolean true enables the mark', () => {
    expect(normalizeDocumentWatermark({ enabled: 'true' }).enabled).toBe(false);
    expect(normalizeDocumentWatermark({ enabled: 1 }).enabled).toBe(false);
    expect(normalizeDocumentWatermark({ enabled: true }).enabled).toBe(true);
  });

  it('clamps into the documented ranges without inventing values', () => {
    expect(normalizeDocumentWatermark({ sizePercent: 15, opacity: 0.04 })).toEqual({ enabled: false, sizePercent: 15, opacity: 0.04 });
    expect(normalizeDocumentWatermark({ sizePercent: 70, opacity: 0.3 })).toEqual({ enabled: false, sizePercent: 70, opacity: 0.3 });
    expect(normalizeDocumentWatermark({ sizePercent: -20, opacity: 4 }).sizePercent).toBe(15);
    expect(normalizeDocumentWatermark({ sizePercent: -20, opacity: 4 }).opacity).toBe(0.3);
  });

  it('covers every eligible document type and its quick/duplicate aliases', () => {
    for (const documentType of ['prescription', 'invoice', 'visit-summary', 'appointment-card', 'report']) {
      expect(supportsLogoWatermark(documentType), documentType).toBe(true);
      expect(supportsLogoWatermark(`quick-${documentType}`), documentType).toBe(true);
    }
    expect(supportsLogoWatermark('prescription-duplicate')).toBe(true);
    for (const documentType of ['receipt', 'quick-receipt', 'stock-labels', 'quick-stock-labels', '', null, undefined]) {
      expect(supportsLogoWatermark(documentType), String(documentType)).toBe(false);
    }
  });

  it('keeps the page box on the physical A4 page for odd profile input', () => {
    expect(pageSizeFromProfile({ orientation: 'landscape' })).toEqual({ widthMm: 297, heightMm: 210 });
    expect(pageSizeFromProfile({ orientation: 'A5' })).toEqual({ widthMm: 210, heightMm: 297 });
    expect(pageSizeFromProfile(null)).toEqual({ widthMm: 210, heightMm: 297 });
    // A square box on the shorter edge: A4's short edge is 210mm, 50% of it.
    expect(watermarkImageBounds({ widthMm: 0, heightMm: 0 }, 50)).toEqual({ maxWidthMm: 105, maxHeightMm: 105 });
    expect(watermarkImageBounds({ widthMm: 210, heightMm: 297 }, Number.NaN)).toEqual({ maxWidthMm: 84, maxHeightMm: 84 });
  });
});
describe('customize-documents watermark controls', () => {
  const panel = (watermark?: unknown, clinic?: unknown): string => renderToStaticMarkup(
    createElement(
      ToastProvider,
      null,
      createElement(CustomizeDocumentsPanel as never, {
        value: {},
        onChange: () => undefined,
        clinic: clinic ?? null,
        settings: null,
        watermark: watermark ?? null,
        onWatermarkChange: () => undefined,
      } as never),
    ),
  );

  it('ships disabled with the reset control inert until a clinic changes it', () => {
    const html = panel();
    expect(html).toContain('Disabled');
    expect(html).toContain('Enable the clinic-logo watermark (off by default)');
    const reset = /<button[^>]*>Reset watermark<\/button>/.exec(html);
    expect(reset, 'reset control is missing').not.toBeNull();
    expect((reset as RegExpExecArray)[0]).toContain('disabled');
    // Nothing is drawn over the preview document while the feature is off.
    expect(html).not.toContain('print-logo-watermark');
    expect(html).toContain('Upload and save a clinic logo in Settings');
  });

  it('previews the mark and enables reset once a logo and settings exist', () => {
    const html = panel(
      { enabled: true, sizePercent: 55, opacity: 0.2 },
      { logoDataUrl: 'data:image/png;base64,AA==' },
    );
    expect(html).toContain('Enabled');
    expect(html).toContain('print-logo-watermark');
    const reset = /<button[^>]*>Reset watermark<\/button>/.exec(html);
    expect(reset, 'reset control is missing').not.toBeNull();
    expect((reset as RegExpExecArray)[0]).not.toContain('disabled');
    // The window is clamped to the supported range, so the UI cannot ask for
    // a mark that normalization would silently change.
    expect(html).toContain('min="15"');
    expect(html).toContain('max="70"');
  });
});

