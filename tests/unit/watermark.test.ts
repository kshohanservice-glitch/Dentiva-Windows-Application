/**
 * Clinic-logo watermark — geometry, validation and rendering contract.
 *
 * The feature has to be invisible for every installation that does not enable
 * it, exactly centred on the paper when it is enabled, and it must never
 * distort the logo or cover patient-critical content. Those are the properties
 * asserted here, on the pure module plus the real React layer.
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  WATERMARK_DEFAULT, WATERMARK_EXCLUDED_KINDS, WATERMARK_LIMITS,
  normalizeWatermarkSettings, watermarkAppliesTo, watermarkBoxMm, watermarkEnabled,
} from '../../src/shared/watermark';
import { WatermarkLayer } from '../../src/renderer/documents/watermark-layer';

const LOGO = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

describe('watermark settings are off until a clinic turns them on', () => {
  it('defaults to disabled', () => {
    expect(WATERMARK_DEFAULT.enabled).toBe(false);
    expect(normalizeWatermarkSettings(undefined)).toEqual(WATERMARK_DEFAULT);
    expect(normalizeWatermarkSettings({})).toEqual(WATERMARK_DEFAULT);
    expect(normalizeWatermarkSettings('nonsense')).toEqual(WATERMARK_DEFAULT);
  });

  it('treats only boolean true as enabled', () => {
    expect(normalizeWatermarkSettings({ enabled: true }).enabled).toBe(true);
    for (const value of ['true', 1, 'yes', {}, null, undefined]) {
      expect(normalizeWatermarkSettings({ enabled: value }).enabled, String(value)).toBe(false);
    }
  });

  it('clamps and rounds out-of-range size / opacity instead of failing', () => {
    expect(normalizeWatermarkSettings({ sizePercent: 5 }).sizePercent).toBe(WATERMARK_LIMITS.sizePercent.min);
    expect(normalizeWatermarkSettings({ sizePercent: 9000 }).sizePercent).toBe(WATERMARK_LIMITS.sizePercent.max);
    expect(normalizeWatermarkSettings({ sizePercent: 54.6 }).sizePercent).toBe(55);
    expect(normalizeWatermarkSettings({ sizePercent: Number.NaN }).sizePercent).toBe(WATERMARK_DEFAULT.sizePercent);
    expect(normalizeWatermarkSettings({ opacity: 0 }).opacity).toBe(WATERMARK_LIMITS.opacity.min);
    expect(normalizeWatermarkSettings({ opacity: 5 }).opacity).toBe(WATERMARK_LIMITS.opacity.max);
    expect(normalizeWatermarkSettings({ opacity: 0.083 }).opacity).toBe(0.08);
    expect(normalizeWatermarkSettings({ opacity: 'x' }).opacity).toBe(WATERMARK_DEFAULT.opacity);
  });

  it('keeps the documented ceiling well below full opacity so text stays legible', () => {
    expect(WATERMARK_LIMITS.opacity.max).toBeLessThanOrEqual(0.5);
    expect(WATERMARK_DEFAULT.opacity).toBeLessThan(0.2);
  });

  it('never renders without both the switch and a logo', () => {
    expect(watermarkEnabled(WATERMARK_DEFAULT, LOGO)).toBe(false);
    expect(watermarkEnabled({ ...WATERMARK_DEFAULT, enabled: true }, null)).toBe(false);
    expect(watermarkEnabled({ ...WATERMARK_DEFAULT, enabled: true }, '')).toBe(false);
    expect(watermarkEnabled({ ...WATERMARK_DEFAULT, enabled: true }, LOGO)).toBe(true);
  });
});

describe('watermark geometry is page-relative, never window-relative', () => {
  it('sizes the box as a fraction of the real page in both directions', () => {
    const settings = normalizeWatermarkSettings({ enabled: true, sizePercent: 50, opacity: 0.1 });
    expect(watermarkBoxMm(settings, 210, 297)).toEqual({ widthMm: 105, heightMm: 148.5 });
    // Landscape A4 keeps the same fractions, so the mark stays centred.
    expect(watermarkBoxMm(settings, 297, 210)).toEqual({ widthMm: 148.5, heightMm: 105 });
    // A5 and a custom roll are handled by the same formula.
    expect(watermarkBoxMm(settings, 148, 210)).toEqual({ widthMm: 74, heightMm: 105 });
    expect(watermarkBoxMm(settings, 80, 200)).toEqual({ widthMm: 40, heightMm: 100 });
  });

  it('falls back to A4 for a broken page size instead of producing NaN', () => {
    const settings = { ...WATERMARK_DEFAULT, enabled: true, sizePercent: 100 };
    expect(watermarkBoxMm(settings, Number.NaN, 0)).toEqual({ widthMm: 210, heightMm: 297 });
    expect(watermarkBoxMm(settings, -5, -5)).toEqual({ widthMm: 210, heightMm: 297 });
  });

  it('normalizes whatever it is handed, so an unnormalized caller cannot break it', () => {
    expect(watermarkBoxMm({ enabled: true, sizePercent: 1000, opacity: 9 } as any, 200, 200).widthMm).toBe(200);
  });
});

describe('document coverage', () => {
  it('applies to the documents a clinic would expect', () => {
    for (const kind of [
      'prescription', 'prescription-duplicate', 'invoice', 'receipt', 'visit-summary',
      'appointment-card', 'report',
      'quick-prescription', 'quick-invoice', 'quick-receipt', 'quick-visit-summary',
      'quick-appointment-card',
    ]) {
      expect(watermarkAppliesTo(kind), kind).toBe(true);
    }
  });

  it('excludes the compact stock & expiry label sheet', () => {
    for (const kind of WATERMARK_EXCLUDED_KINDS) {
      expect(watermarkAppliesTo(kind), kind).toBe(false);
    }
  });

  it('does not silently inherit for an unknown or missing document kind', () => {
    // Explicit allow-list: a future document type must opt in deliberately.
    for (const kind of ['', null, undefined, 'some-new-document', 'thermal-receipt']) {
      expect(watermarkAppliesTo(kind as string), String(kind)).toBe(false);
    }
  });
});

describe('WatermarkLayer rendering', () => {
  const layer = (props: Partial<Parameters<typeof WatermarkLayer>[0]>) =>
    renderToStaticMarkup(createElement(WatermarkLayer, {
      pageWidthMm: 210, pageHeightMm: 297, ...props,
    } as Parameters<typeof WatermarkLayer>[0]));

  it('renders nothing at all in the default (disabled) configuration', () => {
    // Byte-identical output for an installation that never enables the feature.
    expect(layer({ settings: WATERMARK_DEFAULT, logoDataUrl: LOGO, documentKind: 'prescription' })).toBe('');
    expect(layer({ settings: undefined, logoDataUrl: LOGO, documentKind: 'invoice' })).toBe('');
  });

  it('renders nothing when the watermark is enabled but no logo is configured', () => {
    expect(layer({ settings: { ...WATERMARK_DEFAULT, enabled: true }, logoDataUrl: null, documentKind: 'invoice' })).toBe('');
  });

  it('renders nothing for an excluded document even when enabled', () => {
    expect(layer({ settings: { ...WATERMARK_DEFAULT, enabled: true }, logoDataUrl: LOGO, documentKind: 'stock-labels' })).toBe('');
  });

  it('renders one centred box sized in millimetres, with transparency on the logo only', () => {
    const html = layer({
      settings: { enabled: true, sizePercent: 50, opacity: 0.1 },
      logoDataUrl: LOGO,
      documentKind: 'prescription',
    });
    expect(html).toContain('data-watermark="clinic-logo"');
    expect(html).toContain('data-watermark-box="1"');
    expect(html).toContain('width:105mm');
    expect(html).toContain('height:148.5mm');
    expect(html).toContain('opacity:0.1');
    expect(html).toContain(`src="${LOGO}"`);
    // Decorative only: hidden from assistive tech, and it must not be draggable
    // into the document flow as content.
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('alt=""');
    expect(html.match(/data-watermark-box/g)).toHaveLength(1);
  });
});
