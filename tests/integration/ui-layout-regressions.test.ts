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

function readSource(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
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
    expect(css).toMatch(/\.quick-line-grid\s*\{[^}]*align-items:\s*start/s);
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

describe('responsive layout wraps gracefully instead of overflowing', () => {
  it('invoice-line has a responsive breakpoint that moves to 2 columns', () => {
    const css = readSource('src/renderer/styles/global.css');
    // Verify a 980px breakpoint exists with invoice-line 2-column layout.
    // The CSS may have multiple rules within the media query, so we verify:
    // 1) A @media (max-width: 980px) block exists
    // 2) Within that block, .invoice-line gets grid-template-columns: repeat(2, ...)
    // We extract the 980px media query block and check it contains the invoice-line rule.
    const mediaMatch = css.match(/@media\s*\(max-width:\s*980px\)\s*\{([\s\S]*?)\n\}/);
    expect(mediaMatch).not.toBeNull();
    const mediaBlock = mediaMatch![1];
    expect(mediaBlock).toContain('.invoice-line');
    expect(mediaBlock).toMatch(/grid-template-columns:\s*repeat\(2/);
  });

  it('medicine-entry-grid has a responsive single-column breakpoint', () => {
    const css = readSource('src/renderer/styles/global.css');
    // Verify a 680px breakpoint exists with single-column layout.
    const mediaMatch = css.match(/@media\s*\(max-width:\s*680px\)\s*\{([\s\S]*?)\n\}/);
    expect(mediaMatch).not.toBeNull();
    const mediaBlock = mediaMatch![1];
    expect(mediaBlock).toContain('.medicine-entry-grid');
    expect(mediaBlock).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  });
});

describe('walk-in invoice line grid — two-row layout at narrow widths (reported bug fix)', () => {
  const css = readSource('src/renderer/styles/global.css');

  it('declares container-type on quick-line-card so the card width drives the layout', () => {
    expect(css).toContain('container-type: inline-size');
    expect(css).toContain('.quick-line-card');
  });

  it('has a @container rule that lays out the invoice fields in two rows', () => {
    // The primary mechanism: a 3-column grid at <=420px card width
    // with grid-template-areas that encode the two-row layout.
    const block420 = css.match(/@container\s*\(max-width:\s*420px\)\s*\{([\s\S]*?)\n\}/);
    expect(block420).not.toBeNull();
    const inner = block420![1];
    expect(inner).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))');
    expect(inner).toContain('"desc desc desc"');
    expect(inner).toContain('"qty  price discount"');
    expect(inner).toContain('"total total total"');
  });

  it('puts Item/Procedure on its own row spanning all columns at narrow widths', () => {
    const block420 = css.match(/@container\s*\(max-width:\s*420px\)\s*\{([\s\S]*?)\n\}/)![1];
    expect(block420).toContain('.quick-line-description');
    expect(block420).toMatch(/grid-area:\s*desc/);
  });

  it('puts Discount and Line Total on the second row at narrow widths', () => {
    const block420 = css.match(/@container\s*\(max-width:\s*420px\)\s*\{([\s\S]*?)\n\}/)![1];
    // .quick-line-total is placed in the "total total total" grid area —
    // a dedicated row, separate from the "qty price discount" row that holds
    // Qty, Unit price, and Discount.
    expect(block420).toContain('.quick-line-total');
    expect(block420).toMatch(/grid-area:\s*total/);
    // Line total spans all three columns, confirming it is on its own row.
    expect(block420).toContain('grid-column: 1 / -1');
  });

  it('still has a 680px viewport fallback that collapses to a single column', () => {
    const mediaMatch = css.match(/@media\s*\(max-width:\s*680px\)\s*\{([\s\S]*?)\n\}/);
    expect(mediaMatch).not.toBeNull();
    const block = mediaMatch![1];
    expect(block).toContain('.quick-line-grid');
    expect(block).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  });

  it('does not use absolute positioning for the invoice line layout', () => {
    // Guard against future absolute-positioning workarounds.
    const quickLineRules = css.match(/\..*quick-line-grid.*\{([\s\S]*?)\n\}/g) ?? [];
    for (const rule of quickLineRules) {
      expect(rule).not.toContain('position: absolute');
    }
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
