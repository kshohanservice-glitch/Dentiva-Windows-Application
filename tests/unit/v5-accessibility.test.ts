// v5 accessibility regressions (V5-035). Found by the automated axe-core scan
// (scripts/layout-audit.mjs --axe, WCAG 2.1 A/AA, light + dark themes):
// white text on dark-theme fills (1.89–2.51:1), an unlabelled select, an
// aria-label hiding the visible name, aria-readonly on a generic element, a
// tablist without tabs and scroll regions unreachable by keyboard.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const tokensCss = read('src/renderer/styles/tokens.css');
const globalCss = read('src/renderer/styles/global.css');

/** Custom properties declared directly in the first block opened by `selector`. */
function themeTokens(selector: string): Map<string, string> {
  const start = tokensCss.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const body = tokensCss.slice(start, tokensCss.indexOf('\n}', start));
  const map = new Map<string, string>();
  for (const m of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) map.set(m[1], m[2].trim());
  return map;
}

function resolveColor(tokens: Map<string, string>, fallback: Map<string, string>, name: string): string {
  let v = tokens.get(name) ?? fallback.get(name);
  for (let i = 0; i < 5 && v && v.startsWith('var('); i += 1) {
    const ref = /var\((--[\w-]+)/.exec(v)![1];
    v = tokens.get(ref) ?? fallback.get(ref);
  }
  expect(v, name).toMatch(/^#[0-9a-f]{6}$/i);
  return v!;
}

function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = hex.slice(1).match(/../g)!.map((h) => parseInt(h, 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('V5-035 text on filled controls meets WCAG AA in both themes', () => {
  const light = themeTokens(':root');
  const dark = themeTokens("[data-theme='dark']");
  const pairs: [string, string][] = [
    ['--brand-700', '--text-on-brand'], // primary button, active segment, calendar day, setup step
    ['--brand-800', '--text-on-brand'], // primary button hover
    ['--brand-600', '--text-on-brand'], // selected tooth surface
    ['--danger', '--text-on-danger'], // danger button
    ['--danger-hover', '--text-on-danger'],
    ['--success', '--text-on-success'], // completed setup step
  ];
  for (const [theme, tokens] of [['light', light], ['dark', dark]] as const) {
    for (const [fill, text] of pairs) {
      it(`${theme}: ${text} on ${fill} >= 4.5:1`, () => {
        const ratio = contrast(resolveColor(tokens, light, fill), resolveColor(tokens, light, text));
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it('filled controls use the on-colour tokens, never hard-coded white', () => {
    for (const rule of [
      /\.btn-danger \{[^}]*color: var\(--text-on-danger\)/,
      /\.seg button\.active \{[^}]*color: var\(--text-on-brand\)/,
      /\.cal-day\.active \{[^}]*color: var\(--text-on-brand\)/,
      /\.setup-step\.active \.n \{[^}]*color: var\(--text-on-brand\)/,
      /\.setup-step\.done \.n \{[^}]*color: var\(--text-on-success\)/,
      /\.surface\.selected \{[^}]*color: var\(--text-on-brand\)/,
    ]) {
      expect(globalCss).toMatch(rule);
    }
  });
});

describe('V5-035 names, roles and keyboard access', () => {
  it('the WhatsApp consent select has an accessible name', () => {
    expect(read('src/renderer/pages/Patients.tsx')).toMatch(/<Select\s+ariaLabel="WhatsApp consent"\s+value=\{values\.whatsappConsent/);
  });

  it("the appointment patient link's name includes its visible text (WCAG 2.5.3)", () => {
    const src = read('src/renderer/pages/Appointments.tsx');
    expect(src).not.toContain('aria-label={`Open profile of');
    expect(src).toContain('title="Open patient profile"');
  });

  it('computed totals carry no aria-readonly (not allowed on a generic element)', () => {
    expect(read('src/renderer/pages/Patients.tsx')).not.toContain('aria-readonly');
    expect(read('src/renderer/pages/QuickDocuments.tsx')).not.toContain('aria-readonly');
  });

  it('the dentition switch is a toggle group with pressed state', () => {
    const src = read('src/renderer/components/ToothChart.tsx');
    expect(src).toContain('<div className="seg" role="group" aria-label="Dentition">');
    expect(src).toContain("aria-pressed={dentition === 'adult'}");
    expect(src).toContain("aria-pressed={dentition === 'pediatric'}");
  });

  it('scrollable previews are keyboard-reachable regions; the focus ring never prints', () => {
    expect(read('src/renderer/documents/document-preview.tsx')).toContain('tabIndex={0} role="region" aria-label="Document preview"');
    expect(read('src/renderer/pages/PrintPage.tsx')).toContain('<div className="print-stage" tabIndex={0} role="region" aria-label="Print preview">');
    expect(read('src/renderer/styles/print.css')).toMatch(/@media print \{[\s\S]*?\.print-stage \{[^}]*outline: none !important;/);
  });
});
