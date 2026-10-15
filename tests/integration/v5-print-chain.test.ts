/**
 * v5 Phase 5 — the print chain: data → template, and multi-page rules.
 *
 * V5-027: report services key their totals by label (as the Reports screen
 * shows them); the printed report used to look them up by column id, so every
 * printed report showed an empty "Total" row. The real service output is
 * rendered through the real print template here.
 *
 * V5-026 / V5-025: stylesheet guards for multi-page output (margins on every
 * sheet, no whole-table "avoid", grand totals printed once) and for the taka
 * sign glyph in printed amounts. The geometry itself is measured from real PDFs
 * by `node scripts/layout-audit.mjs --pdf --long` (docs/audits/v5/PRINTING_A4_AUDIT.md).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createElement, type FunctionComponent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupEnv, createTestEnv, ownerCtx, type TestEnv } from '../helpers';
import { runReport } from '../../src/main/services/reports';
import { createPatient } from '../../src/main/services/patients';
import { reportDoc } from '../../src/renderer/documents/print-documents';
import { DOCUMENT_SAMPLES } from '../../src/renderer/documents/samples';

let env: TestEnv;
beforeEach(() => { env = createTestEnv('v5-print-chain'); });
afterEach(() => { cleanupEnv(env); });

const render = (data: unknown): string =>
  renderToStaticMarkup(createElement(reportDoc as unknown as FunctionComponent<any>, data));

const clinic = { clinicName: 'Print Chain Clinic', currency: 'BDT' };

function pay(patientId: number, amountPaisa: number, type: 'payment' | 'refund' = 'payment'): void {
  const at = new Date().toISOString();
  env.db.prepare(
    `INSERT INTO payments (invoice_id, patient_id, amount_paisa, method, reference, type, received_by, paid_at, note, created_at)
     VALUES (NULL, ?, ?, 'cash', NULL, ?, 1, ?, NULL, ?)`,
  ).run(patientId, amountPaisa, type, at, at);
}

describe('V5-027 printed reports carry the totals the service computed', () => {
  it('collection report prints its net collection', () => {
    const owner = ownerCtx(env);
    const p = createPatient(owner, { name: 'Chain Patient', gender: 'female', ageYears: 33, phone: '01766666666' });
    pay(p.id, 125000);
    pay(p.id, 25000, 'refund');
    const report = runReport(owner, 'collection_report', {});
    expect(report.totals).toHaveProperty('Net collection', '৳1,000.00');
    const html = render({ report, clinic });
    expect(html).toContain('Net collection');
    expect(html).toContain('৳1,000.00');
    expect(html).toContain('report-summary');
  });

  it('every catalogue report with totals prints each total label', () => {
    const owner = ownerCtx(env);
    for (const name of ['daily_summary', 'monthly_revenue', 'outstanding_dues', 'payment_methods', 'profit_loss', 'expense_summary', 'stock_on_hand']) {
      const report = runReport(owner, name, {});
      const html = render({ report, clinic });
      for (const label of Object.keys(report.totals ?? {})) {
        if (report.columns.some((c) => c.key === label)) continue;
        expect(html, `${name}: ${label}`).toContain(label.replace(/&/g, '&amp;'));
      }
    }
  });

  it('column-keyed totals keep the original single footer row (layout contract)', () => {
    const html = render(DOCUMENT_SAMPLES.report());
    expect(html.match(/<tfoot>/g)).toHaveLength(1);
    expect(html).not.toContain('report-summary');
  });
});

describe('V5-026 / V5-025 multi-page and glyph rules in print.css', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '..', '..', 'src', 'renderer', 'styles', 'print.css'), 'utf8');

  it('repeats the profile margins on every printed sheet', () => {
    const printBlock = css.slice(css.indexOf('@media print'), css.indexOf('\n.print-root {'));
    expect(printBlock).toMatch(/\.print-doc\s*\{[^}]*box-decoration-break:\s*clone/s);
  });

  it('never keeps a whole table together, but never splits a row', () => {
    expect(css).not.toMatch(/\.print-doc table\s*\{[^}]*break-inside:\s*avoid/s);
    expect(css).toMatch(/\.print-doc tr,[\s\S]*?break-inside:\s*avoid/);
    expect(css).toContain('.print-doc thead { display: table-header-group; }');
    expect(css).toContain('.print-doc tfoot { display: table-row-group; }');
  });

  it('never strands a heading or clinical label without its content', () => {
    // Measured on the landscape prescription: "TREATMENT" ended page 1 while its
    // text started page 2.
    const headingRule = /\.print-doc h2,([^{]*)\{([^}]*)\}/s.exec(css);
    expect(headingRule, 'heading keep-with-next rule').not.toBeNull();
    for (const sel of ['.prescription-column-title', '.rx-heading', '.clinical-label']) {
      expect(headingRule![1]).toContain(sel);
    }
    expect(headingRule![2]).toMatch(/break-after:\s*avoid/);
    expect(css).toMatch(/\.print-doc tr,[^{]*\.print-doc \.clinical-field,[^{]*\{[^}]*break-inside:\s*avoid/s);
  });

  it('lets the prescription body break between medicines', () => {
    const rule = /@media print \{\s*\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\/\s*\.prescription-header,\s*\.prescription-patient-strip\s*\{[^}]*\}/s.exec(css);
    expect(rule, 'header/strip avoid rule').not.toBeNull();
    expect(rule![0]).not.toContain('.prescription-body');
  });

  it('ships the font subsets that cover English, Bengali and ৳ (V5-032)', () => {
    const root = path.resolve(__dirname, '..', '..');
    const main = fs.readFileSync(path.join(root, 'src', 'renderer', 'main.tsx'), 'utf8');
    const imports = [...main.matchAll(/import '(@fontsource\/[^']+)';/g)].map((m) => m[1]);
    for (const w of ['400', '500', '600', '700']) {
      expect(imports).toContain(`@fontsource/inter/latin-${w}.css`);
      expect(imports).toContain(`@fontsource/inter/latin-ext-${w}.css`);
    }
    // The "bengali" subset is the Bengali block (U+0980–09FE), which holds ৳
    // (U+09F3); the PDF audit confirms the glyph is embedded from this font.
    for (const w of ['400', '600']) {
      const i = `@fontsource/noto-sans-bengali/bengali-${w}.css`;
      expect(imports).toContain(i);
      const faceCss = fs.readFileSync(path.join(root, 'node_modules', i), 'utf8');
      expect(faceCss).toContain("font-family: 'Noto Sans Bengali'");
      expect(faceCss).toContain(`noto-sans-bengali-bengali-${w}-normal.woff2`);
    }
  });

  it('printed amounts fall back to the bundled Bengali font for ৳', () => {
    expect(css).toMatch(/\.print-doc \.mono\s*\{[^}]*'Noto Sans Bengali'/s);
  });
});
