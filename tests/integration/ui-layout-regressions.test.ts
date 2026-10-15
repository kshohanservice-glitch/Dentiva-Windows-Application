import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regression tests for the UI layout audit.
 *
 * These tests guard the structural decisions made during the comprehensive
 * UI/layout audit. They verify that the source files contain (or no longer
 * contain) the expected patterns, so that a future change cannot silently
 * reintroduce the alignment, overflow, and redundant-helper-text problems
 * that were fixed.
 */

const repoRoot = resolve(__dirname, '..', '..');

/**
 * Source text with line endings normalised to LF. Windows checkouts (and the
 * Windows CI runner) materialise these files with CRLF, so every assertion in
 * this file must be line-ending agnostic.
 */
function readSource(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

describe('redundant helper text removed', () => {
  it('medicine-entry-editor does not repeat the label as a hint', () => {
    const src = readSource('src/renderer/components/medicine-entry-editor.tsx');
    // Labels were shortened and redundant hints removed.
    expect(src).not.toContain('hint="Structured note');
    // The one-line instruction field keeps a genuinely useful hint
    // (it explains that the structured fields are replaced).
    expect(src).toContain('Replaces the structured dosage');
  });

  it('quick-documents invoice lines do not repeat unit-price meaning as hint', () => {
    const src = readSource('src/renderer/pages/QuickDocuments.tsx');
    expect(src).not.toContain('hint="Price for one item or procedure."');
    expect(src).not.toContain('hint="Optional; deducted from this line only."');
    expect(src).not.toContain('hint="Applied once after line discounts."');
    expect(src).not.toContain('hint="Used to calculate the balance due');
  });

  it('patient invoice form does not repeat unit-price or line-total as hint', () => {
    const src = readSource('src/renderer/pages/Patients.tsx');
    expect(src).not.toContain('hint="Price for one item or procedure."');
    expect(src).not.toContain('hint="Quantity × unit price; the invoice-wide discount is applied below."');
    expect(src).not.toContain('hint="Applied once to the invoice after the line amounts are added."');
  });

  it('patient prescription form does not have redundant C/C and O/E hints', () => {
    const src = readSource('src/renderer/pages/Patients.tsx');
    expect(src).not.toContain('hint="Choose a common entry, or select Other to type the patient');
    expect(src).not.toContain('hint="Choose a listed finding, or select Other to enter the clinician');
  });
});

describe('prescription print layout fills the page', () => {
  it('print-doc uses flex column so the prescription body can stretch', () => {
    const css = readSource('src/renderer/styles/print.css');
    expect(css).toContain('.print-doc');
    expect(css).toMatch(/\.print-doc\s*\{[^}]*display:\s*flex/s);
    expect(css).toMatch(/\.print-doc\s*\{[^}]*flex-direction:\s*column/s);
  });

  it('print-doc-content is a flex column that fills the available height', () => {
    const css = readSource('src/renderer/styles/print.css');
    expect(css).toMatch(/\.print-doc-content\s*\{[^}]*display:\s*flex/s);
    expect(css).toMatch(/\.print-doc-content\s*\{[^}]*flex:\s*1\s+1\s+auto/s);
  });

  it('prescription-body stretches to fill available height', () => {
    const css = readSource('src/renderer/styles/print.css');
    expect(css).toMatch(/\.prescription-body\s*\{[^}]*flex:\s*1\s+1\s+auto/s);
  });

  it('prescription-header and patient-strip do not shrink', () => {
    const css = readSource('src/renderer/styles/print.css');
    expect(css).toMatch(/\.prescription-header\s*\{[^}]*flex-shrink:\s*0/s);
    expect(css).toMatch(/\.prescription-patient-strip\s*\{[^}]*flex-shrink:\s*0/s);
  });

  it('print-footer is pushed to the bottom of the page', () => {
    const css = readSource('src/renderer/styles/print.css');
    expect(css).toMatch(/\.print-footer\s*\{[^}]*margin-top:\s*auto/s);
  });

  it('medication-list stretches within the prescription column', () => {
    const css = readSource('src/renderer/styles/print.css');
    expect(css).toMatch(/\.medication-list\s*\{[^}]*flex:\s*1\s+1\s+auto/s);
  });
});

describe('form grid alignment prevents label wrapping from shifting inputs', () => {
  it('medicine-entry-grid uses align-items: start', () => {
    const css = readSource('src/renderer/styles/global.css');
    expect(css).toMatch(/\.medicine-entry-grid\s*\{[^}]*align-items:\s*start/s);
  });

  it('quick-line-grid uses align-items: start', () => {
    const css = readSource('src/renderer/styles/global.css');
    // The invoice line grid is now written with an explicit :not() so the
    // procedure grid keeps its own template.
    expect(css).toMatch(/\.quick-line-grid:not\(\.quick-procedure-grid\)\s*\{[^}]*align-items:\s*start/s);
  });

  it('invoice-line uses align-items: start', () => {
    const css = readSource('src/renderer/styles/global.css');
    expect(css).toMatch(/\.invoice-line\s*\{[^}]*align-items:\s*start/s);
  });

  it('form-grid uses align-items: start', () => {
    const css = readSource('src/renderer/styles/global.css');
    expect(css).toMatch(/\.form-grid\s*\{[^}]*align-items:\s*start/s);
  });

  it('field labels in grids have a minimum height so wrapping labels do not shift inputs', () => {
    const css = readSource('src/renderer/styles/global.css');
    // Medicine entry, quick line, and invoice line grids all share this rule.
    expect(css).toContain('min-height: 2.4em');
  });
});

/* ------------------------------ CSS helpers ------------------------------ */

/** Body of the first brace-free rule with this exact selector. */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  expect(match, `rule not found: ${selector}`).not.toBeNull();
  return match![1];
}

/** Every brace-free rule body for a selector, in source order. */
function ruleBodies(css: string, selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]);
}

/** Source ranges of every @media block, so window rules can be inspected. */
function mediaBlocks(css: string): { query: string; body: string }[] {
  const blocks: { query: string; body: string }[] = [];
  const marker = /@media[^{]*\{/g;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(css)) !== null) {
    let depth = 1;
    let i = match.index + match[0].length;
    const start = i;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') depth -= 1;
      i += 1;
    }
    blocks.push({ query: match[0].replace(/\{$/, '').trim(), body: css.slice(start, i - 1) });
    marker.lastIndex = i;
  }
  return blocks;
}

/** Reads `grid-template-areas` from a rule body as rows of area names. */
function areaRows(body: string): string[][] {
  const match = body.match(/grid-template-areas\s*:\s*([^;]+);/);
  expect(match, 'grid-template-areas missing').not.toBeNull();
  return [...match![1].matchAll(/'([^']+)'/g)].map((row) => row[1].split(/\s+/));
}

/** Deduplicated area names of a row, preserving left-to-right order. */
function rowOrder(row: string[]): string[] {
  return [...new Set(row)];
}

describe('walk-in invoice lines are laid out from the panel width, not the window', () => {
  it('puts Item/Qty/Unit price on the first row and Discount/Line total on the second', () => {
    const css = readSource('src/renderer/styles/global.css');
    const narrow = ruleBody(css, '.quick-line-grid:not(.quick-procedure-grid)');
    const rows = areaRows(narrow);
    expect(rows).toHaveLength(2);
    expect(rowOrder(rows[0])).toEqual(['item', 'qty', 'price']);
    expect(rowOrder(rows[1])).toEqual(['discount', 'total']);
  });

  it('keeps a compact single row, but only under a container query that fits it', () => {
    const css = readSource('src/renderer/styles/global.css');
    // The wide variant is the *second* rule for the selector and must sit inside
    // a container query: window width alone must never force five fields into a
    // panel that cannot hold them.
    const bodies = ruleBodies(css, '.quick-line-grid:not(.quick-procedure-grid)');
    expect(bodies.length).toBeGreaterThanOrEqual(2);
    const wide = bodies[bodies.length - 1];
    expect(areaRows(wide)).toHaveLength(1);
    expect(rowOrder(areaRows(wide)[0])).toEqual(['item', 'qty', 'price', 'discount', 'total']);

    const wideIndex = css.lastIndexOf('.quick-line-grid:not(.quick-procedure-grid)');
    const containerIndex = css.lastIndexOf('@container (min-width: 690px)');
    expect(containerIndex).toBeGreaterThan(-1);
    expect(containerIndex).toBeLessThan(wideIndex);
    // The compact row is only allowed when its minimum column widths plus the
    // gaps genuinely fit the container threshold that triggers it (--sp-3 = 12px).
    const minimums = [...wide.matchAll(/minmax\((\d+)px/g)].map((m) => Number(m[1]));
    expect(minimums).toHaveLength(5);
    const required = minimums.reduce((sum, px) => sum + px, 0) + 12 * 4;
    expect(required).toBeLessThanOrEqual(690);
  });

  it('gives every invoice field an explicit grid area', () => {
    const css = readSource('src/renderer/styles/global.css');
    for (const [selector, area] of [
      ['.quick-line-item', 'item'],
      ['.quick-line-qty', 'qty'],
      ['.quick-line-unit-price', 'price'],
      ['.quick-line-discount', 'discount'],
      ['.quick-line-total', 'total'],
    ] as const) {
      expect(ruleBody(css, selector)).toContain(`grid-area: ${area}`);
    }
  });

  it('measures the line card instead of the window', () => {
    const css = readSource('src/renderer/styles/global.css');
    expect(ruleBody(css, '.medicine-entry-card,\n.quick-line-card')).toContain('container-type: inline-size');
  });

  it('renders the Remove action above the field grid, never inside it', () => {
    const src = readSource('src/renderer/pages/QuickDocuments.tsx');
    const heading = src.indexOf('quick-line-card-heading');
    const removeButton = src.indexOf('Remove invoice line ${index + 1}');
    const grid = src.indexOf('className="quick-line-grid"');
    expect(heading).toBeGreaterThan(-1);
    expect(removeButton).toBeGreaterThan(heading);
    expect(grid).toBeGreaterThan(removeButton);
  });

  it('keeps the invoice fields labelled, required, and state-bound', () => {
    const src = readSource('src/renderer/pages/QuickDocuments.tsx');
    for (const label of ['Item or procedure', 'Qty', 'Unit price (৳)', 'Discount (৳)', 'Line total (৳)']) {
      expect(src).toContain(`label="${label}"`);
    }
    expect(src).toContain('onChange={(value) => setRow(index, { discount: value })}');
    expect(src).toContain('required />}');
    // The line total stays a read-only, computed value.
    expect(src).toContain('aria-readonly="true"');
    expect(src).toContain('<Money paisa={totals.lines[index]?.totalPaisa ?? 0} />');
  });

  it('never re-applies a fixed invoice template from a window media query', () => {
    const css = readSource('src/renderer/styles/global.css');
    for (const block of mediaBlocks(css)) {
      for (const selector of ['.quick-line-grid', '.invoice-line', '.medicine-entry-grid']) {
        expect(block.body, `window rule for ${selector} in ${block.query}`).not.toContain(selector);
      }
    }
  });
});

describe('main invoice lines and medicine entry react to their own panel', () => {
  it('keeps description, quantities and the line total inside the invoice dialog', () => {
    const css = readSource('src/renderer/styles/global.css');
    const narrow = areaRows(ruleBody(css, '.invoice-line'));
    expect(rowOrder(narrow[0])).toEqual(['description', 'qty', 'price', 'remove']);
    expect(rowOrder(narrow[1])).toEqual(['total']);
    const bodies = ruleBodies(css, '.invoice-line');
    const wide = areaRows(bodies[bodies.length - 1]);
    expect(wide).toHaveLength(1);
    expect(rowOrder(wide[0])).toEqual(['description', 'qty', 'price', 'total', 'remove']);
    expect(css.lastIndexOf('@container (min-width: 620px)')).toBeLessThan(css.lastIndexOf('.invoice-line {'));
  });

  it('keeps the remove control in the line grid without overlapping a field', () => {
    const css = readSource('src/renderer/styles/global.css');
    const remove = ruleBody(css, '.invoice-line > .btn');
    expect(remove).toContain('grid-area: remove');
    expect(remove).toContain('align-self: end');
    expect(readSource('src/renderer/pages/Patients.tsx')).toContain('ariaLabel={`Remove invoice line ${i + 1}`}');
  });

  it('declares the invoice-lines wrapper as the measured container', () => {
    const css = readSource('src/renderer/styles/global.css');
    expect(ruleBody(css, '.invoice-lines')).toContain('container-type: inline-size');
    expect(readSource('src/renderer/pages/Patients.tsx')).toContain('<div className="invoice-lines">');
  });

  it('scales the medicine entry grid from one to three columns by panel width', () => {
    const css = readSource('src/renderer/styles/global.css');
    const bodies = ruleBodies(css, '.medicine-entry-grid');
    expect(bodies[0]).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(bodies[1]).toContain('repeat(2, minmax(0, 1fr))');
    expect(bodies[2]).toContain('repeat(3, minmax(0, 1fr))');
    expect(css.indexOf('@container (min-width: 430px)')).toBeLessThan(css.indexOf('@container (min-width: 680px)'));
  });
});

describe('grid tracks and their children can always shrink', () => {
  it('lets the quick-document and customize panels shrink inside the page', () => {
    const css = readSource('src/renderer/styles/documents.css');
    expect(css).toContain('.quick-grid > *,\n.customize-grid > * { min-width: 0; }');
  });

  it('keeps the page-level splits shrinkable and stacks them when narrow', () => {
    const css = readSource('src/renderer/styles/global.css');
    for (const selector of ['.dashboard-split', '.reports-split', '.about-split']) {
      expect(ruleBody(css, selector)).toContain('minmax(0,');
    }
    expect(css).toContain('.about-split > * { min-width: 0; }');
    const stack = mediaBlocks(css).find((b) => b.query.includes('max-width: 900px'));
    expect(stack).toBeDefined();
    for (const selector of ['.dashboard-split', '.reports-split', '.about-split']) {
      expect(stack!.body).toContain(selector);
    }
  });

  it('keeps the patient overview grid and its full-width card in one column set', () => {
    const css = readSource('src/renderer/styles/global.css');
    expect(ruleBody(css, '.patient-overview-grid')).toContain('repeat(auto-fit, minmax(280px, 1fr))');
    expect(ruleBody(css, '.patient-overview-grid .span-2')).toContain('grid-column: 1 / -1');
  });
});

describe('medicine entry labels shortened for alignment', () => {
  it('uses "Medicine" not "Medicine name"', () => {
    const src = readSource('src/renderer/components/medicine-entry-editor.tsx');
    expect(src).toContain('label="Medicine"');
    expect(src).not.toContain('label="Medicine name"');
  });

  it('uses "Generic name" not "Generic name (optional)"', () => {
    const src = readSource('src/renderer/components/medicine-entry-editor.tsx');
    expect(src).toContain('label="Generic name"');
    expect(src).not.toContain('label="Generic name (optional)"');
  });

  it('uses "Form" not "Dosage form"', () => {
    const src = readSource('src/renderer/components/medicine-entry-editor.tsx');
    expect(src).toContain('label="Form"');
    expect(src).not.toContain('label="Dosage form"');
  });

  it('uses "Qty" not "Quantity"', () => {
    const src = readSource('src/renderer/components/medicine-entry-editor.tsx');
    expect(src).toContain('label="Qty"');
  });

  it('uses "Admin. note" not "Administration note"', () => {
    const src = readSource('src/renderer/components/medicine-entry-editor.tsx');
    expect(src).toContain('label="Admin. note"');
    expect(src).not.toContain('label="Administration note"');
  });

  it('uses "Medicine instruction" not "One-line medicine instruction (optional)"', () => {
    const src = readSource('src/renderer/components/medicine-entry-editor.tsx');
    expect(src).toContain('label="Medicine instruction"');
    expect(src).not.toContain('label="One-line medicine instruction (optional)"');
  });
});
