/**
 * Phase B — print pipeline unit tests (CSS page geometry).
 * Electron is mocked: only pure helpers are exercised here; the window/print
 * paths are covered by the packaged E2E (print window opens with content).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: class {},
  dialog: {},
  app: { getAppPath: () => '/app' },
}));

import { profilePageCss } from '../../src/main/print';
import type { PrintProfile } from '../../src/shared/types';

function profile(patch: Partial<PrintProfile>): PrintProfile {
  return {
    id: 'p', name: 'Test', documentType: 'prescription', printerName: '',
    paperSize: 'a4', widthMm: 80, heightMm: 200, orientation: 'portrait',
    margins: { top: 10, right: 8, bottom: 10, left: 8 }, scale: 100, copies: 1,
    ...patch,
  };
}

describe('profilePageCss (@page geometry)', () => {
  it('A4 portrait → 210×297 mm with profile margins', () => {
    const css = profilePageCss(profile({ paperSize: 'a4' }));
    expect(css).toContain('size: 210mm 297mm');
    expect(css).toContain('margin: 10mm 8mm 10mm 8mm');
  });

  it('A4 landscape swaps to 297×210 mm', () => {
    const css = profilePageCss(profile({ paperSize: 'a4', orientation: 'landscape' }));
    expect(css).toContain('size: 297mm 210mm');
  });

  it('A5 portrait → 148×210 mm; landscape swaps', () => {
    expect(profilePageCss(profile({ paperSize: 'a5' }))).toContain('size: 148mm 210mm');
    expect(profilePageCss(profile({ paperSize: 'a5', orientation: 'landscape' }))).toContain('size: 210mm 148mm');
  });

  it('thermal/custom uses explicit width/height (80mm roll)', () => {
    const css = profilePageCss(profile({ paperSize: 'thermal', widthMm: 80, heightMm: 200 }));
    expect(css).toContain('size: 80mm 200mm');
  });

  it('custom margins flow through verbatim', () => {
    const css = profilePageCss(profile({
      paperSize: 'custom', widthMm: 100, heightMm: 150,
      margins: { top: 5, right: 5, bottom: 5, left: 5 },
    }));
    expect(css).toContain('size: 100mm 150mm');
    expect(css).toContain('margin: 5mm 5mm 5mm 5mm');
  });
});
