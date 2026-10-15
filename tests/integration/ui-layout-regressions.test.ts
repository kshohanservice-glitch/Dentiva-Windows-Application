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


describe('walk-in invoice line two-row layout', () => {
  it('uses the invoice card width for responsive layout', () => {
    const css = readSource('src/renderer/styles/global.css');
    expect(css).toMatch(/\.quick-line-card\s*\{[^}]*container-type:\s*inline-size/s);
    expect(css).toContain('@container (max-width: 620px)');
  });

  it('keeps item, quantity, and unit price on the first row', () => {
    const css = readSource('src/renderer/styles/global.css');
    expect(css).toContain('"description qty price"');
  });

  it('moves discount and line total to the second row', () => {
    const css = readSource('src/renderer/styles/global.css');
    expect(css).toContain('"discount total total"');
    expect(css).toContain('.quick-line-grid > .field:nth-child(4) { grid-area: discount; }');
    expect(css).toContain('.quick-line-total { grid-area: total; }');
  });

  it('keeps the Remove action in the card heading, outside the fields grid', () => {
    const src = readSource('src/renderer/pages/QuickDocuments.tsx');
    expect(src).toContain('quick-line-card-heading');
    expect(src).toContain('ariaLabel={`Remove invoice line ${index + 1}`}');
  });
});
