/**
 * Print pipeline unit tests.
 *
 * Dentiva Pro 5.0.0 supports exactly one document page size: A4. These tests pin
 * that policy at the unit level (one `@page` rule, orientation only), while the
 * window/print paths are covered by the packaged E2E (the print window opens
 * with the document content).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: class {},
  dialog: {},
  app: { getAppPath: () => '/app' },
}));

import { buildPrintHash, marginsMmToPrintMargins, mmToInches } from '../../src/main/print';
import { A4_SIZE_TOLERANCE_MM, a4PageCss, a4PageSize, asA4PageSize } from '../../src/shared/print-page';

describe('A4 page geometry (@page rules)', () => {
  it('A4 portrait → 210×297 mm with zero native page margin', () => {
    const css = a4PageCss('portrait');
    expect(css).toContain('size: 210mm 297mm');
    expect(css).toContain('margin: 0;');
  });

  it('A4 landscape swaps to 297×210 mm', () => {
    const css = a4PageCss('landscape');
    expect(css).toContain('size: 297mm 210mm');
  });

  it('defaults to portrait when no orientation is given', () => {
    expect(a4PageCss()).toBe(a4PageCss('portrait'));
    expect(a4PageSize()).toEqual({ widthMm: 210, heightMm: 297 });
  });

  it('is the only geometry available: the page box depends on nothing else', () => {
    // a4PageSize takes an orientation and nothing more — there is no page-size
    // parameter, no millimetre override and no custom branch.
    expect(a4PageSize.length).toBeLessThanOrEqual(1);
    expect(a4PageSize('portrait')).toEqual({ widthMm: 210, heightMm: 297 });
    expect(a4PageSize('landscape')).toEqual({ widthMm: 297, heightMm: 210 });
  });

  it('resolves any requested page box to A4 (the print/PDF boundary)', () => {
    // An A4 box keeps its orientation (this is what the print window sends).
    expect(asA4PageSize(210, 297)).toEqual({ widthMm: 210, heightMm: 297 });
    expect(asA4PageSize(297, 210)).toEqual({ widthMm: 297, heightMm: 210 });
    // A borderline request inside the tolerance still counts as A4.
    expect(asA4PageSize(210 + A4_SIZE_TOLERANCE_MM, 297)).toEqual({ widthMm: 210, heightMm: 297 });
    // Legacy mediums, junk and missing values all resolve to A4 portrait:
    // the main process never prints or exports another page size.
    for (const [w, h] of [[148, 210], [80, 200], [216, 279], [148, 210], [0, 0], [-1, 5]]) {
      expect(asA4PageSize(w, h), `${w}x${h}`).toEqual({ widthMm: 210, heightMm: 297 });
    }
    expect(asA4PageSize(undefined, undefined)).toEqual({ widthMm: 210, heightMm: 297 });
    expect(asA4PageSize('junk', 297)).toEqual({ widthMm: 210, heightMm: 297 });
    expect(asA4PageSize(210, NaN)).toEqual({ widthMm: 210, heightMm: 297 });
  });

  it('converts mm to inches for Electron printToPDF (ISS-036)', () => {
    // 25.4mm === 1 inch; A4 210x297mm === ~8.2677x11.6929 inches
    expect(mmToInches(25.4)).toBeCloseTo(1, 5);
    expect(mmToInches(210)).toBeCloseTo(8.2677, 3);
    expect(mmToInches(297)).toBeCloseTo(11.6929, 3);
  });

  it('converts custom margins in mm to 96-DPI pixels for Electron print (ISS-036)', () => {
    const m = marginsMmToPrintMargins({ top: 12.7, right: 25.4, bottom: 12.7, left: 25.4 });
    expect(m).toEqual({
      marginType: 'custom',
      top: 48,
      right: 96,
      bottom: 48,
      left: 96,
    });
  });

  it('builds print window hash with report name, profile, and date range params (ISS-011)', () => {
    const hash = buildPrintHash({
      type: 'report',
      id: 0,
      reportName: 'daily_collection',
      profileId: 'inv-a4',
      params: { from: '2026-09-01', to: '2026-09-30' },
    });
    expect(hash).toBe('#print/report/0?report=daily_collection&profile=inv-a4&from=2026-09-01&to=2026-09-30');
  });
});
