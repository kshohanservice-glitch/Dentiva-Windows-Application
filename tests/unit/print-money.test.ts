/**
 * Task A regression tests — financial amount masking must never leak into a
 * printable document (invoice preview, PDF, print output, receipts,
 * prescriptions, visit summaries, patient statements and financial reports).
 *
 * The print/export path renders the authoritative amount from the shared
 * integer formatter. These tests prove the export tree structurally cannot
 * emit the `****` mask, while the ordinary application UI keeps masking.
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
import path from 'node:path';
import { PrintMoney } from '../../src/renderer/components/print-money';
import { FormattedMoney } from '../../src/renderer/components/formatted-money';
import { formatBdt } from '../../src/shared/currency';
import { MONEY_MASK } from '../../src/shared/money-mask';

const repoRoot = path.resolve(__dirname, '..', '..');
const read = (rel: string): string => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

describe('PrintMoney (print / PDF export rendering)', () => {
  it('renders the authoritative integer-exact amount, never the mask', () => {
    for (const paisa of [0, 1, 5, 150000, 123456, 99999999999, -2500]) {
      const html = renderToStaticMarkup(createElement(PrintMoney, { paisa }));
      expect(html).toBe(`<span class="print-money">${formatBdt(paisa)}</span>`);
      expect(html).not.toContain(MONEY_MASK);
    }
  });

  it('renders the shared empty placeholder for missing or unsafe values', () => {
    expect(renderToStaticMarkup(createElement(PrintMoney, { paisa: null }))).toBe('<span class="print-money">—</span>');
    expect(renderToStaticMarkup(createElement(PrintMoney, { paisa: 12.5 }))).toBe('<span class="print-money">—</span>');
    expect(renderToStaticMarkup(createElement(PrintMoney, { paisa: Number.NaN }))).toBe('<span class="print-money">—</span>');
  });

  it('matches the screen formatter exactly, so preview and paper agree', () => {
    const html = renderToStaticMarkup(createElement(PrintMoney, { paisa: 123456 }));
    expect(html).toContain('৳1,234.56');
  });
});

describe('FormattedMoney printable mode (report and mixed-text cells)', () => {
  it('renders real amounts for every money token in a financial report cell', () => {
    const value = 'Cash: ৳1,234.56 · Card: ৳20.00 · Due: ৳0.00';
    const html = renderToStaticMarkup(createElement(FormattedMoney, { value, printable: true }));
    expect(html).toContain('৳1,234.56');
    expect(html).toContain('৳20.00');
    expect(html).toContain('৳0.00');
    expect(html).not.toContain(MONEY_MASK);
  });

  it('keeps non-financial text, ids, counts and dates verbatim', () => {
    const value = 'P-1234, age 45, 2026-10-13';
    const html = renderToStaticMarkup(createElement(FormattedMoney, { value, printable: true }));
    expect(html).toBe('P-1234, age 45, 2026-10-13');
  });

  it('handles legacy "N BDT" audit summaries without masking them', () => {
    const html = renderToStaticMarkup(
      createElement(FormattedMoney, { value: 'Payment 123.45 BDT via cash; refund -2.00 BDT', printable: true }),
    );
    expect(html).toContain('৳123.45');
    expect(html).toContain('-৳2.00');
    expect(html).not.toContain(MONEY_MASK);
  });

  it('still masks on the ordinary screen path (privacy feature is preserved)', () => {
    const src = read('src/renderer/components/formatted-money.tsx');
    // Non-printable rendering must keep going through the masked Money component.
    expect(src).toMatch(/: <Money paisa=\{part\.paisa\} key=\{i\} \/>/);
  });
});

describe('print stylesheet contract', () => {
  const css = read('src/renderer/styles/print.css');

  it('no longer ships the screen/paper masking pair', () => {
    expect(css).not.toContain('.print-money-screen');
    expect(css).not.toContain('.print-money-paper');
  });

  it('styles a single authoritative .print-money element', () => {
    expect(css).toContain('.print-money {');
  });
});

describe('print document tree never imports UI masking', () => {
  const src = read('src/renderer/pages/PrintPage.tsx');

  it('imports the export money components', () => {
    expect(src).toContain("from '../components/print-money'");
    expect(src).toContain("from '../components/formatted-money'");
  });

  it('does not import the masked Money component or the reveal toggle', () => {
    expect(src).not.toContain("from '../components/money'");
    expect(src).not.toContain('MoneyRevealToggle');
    expect(src).not.toContain('maskedAmount');
  });

  it('uses the shared integer formatter, not a private float formatter', () => {
    expect(src).not.toContain('fmtBdt');
    expect(src).not.toContain('toLocaleString');
  });

  it('only renders FormattedMoney in printable mode inside the print document', () => {
    const usages = src.match(/<FormattedMoney\b[^>]*\/>/g) ?? [];
    expect(usages.length).toBeGreaterThan(0);
    for (const usage of usages) expect(usage).toContain('printable');
  });
});
