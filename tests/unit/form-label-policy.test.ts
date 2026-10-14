/**
 * Form-labelling policy regression test (Mandatory 1).
 *
 * The user-facing rule for this release is: **a placeholder is never a label.**
 * Every `Input`, `Select` and `Textarea` in the renderer must be reachable and
 * explicable, which means it carries either
 *
 *   - a visible, associated label (the shared `Field` primitive, which owns the
 *     `for`/`id` pair, or an explicit `<label htmlFor=…>`), or
 *   - an explicit accessible name (`ariaLabel` / `aria-label`) when a visible
 *     label would be wrong for the layout — a search box or a toolbar filter.
 *
 * This test is written against the source markup because that is what a
 * reviewer reads and what a new screen copies. It is deliberately strict: a new
 * unnamed control fails here instead of reaching a clinic.
 *
 * `docs/KNOWN_LIMITATIONS.md` records what this policy intentionally does *not*
 * cover (a filter dropdown keeps its placeholder as the visible affordance, for
 * example, and is only named for assistive technology).
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const rendererRoot = path.resolve(__dirname, '..', '..', 'src', 'renderer');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

interface Finding { file: string; line: number; name: string; control: string }

/** Every control that has neither a visible label nor an accessible name. */
function findUnlabelledControls(): Finding[] {
  const findings: Finding[] = [];
  for (const file of walk(rendererRoot)) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const open = /<(Input|Select|Textarea)\b/.exec(lines[i]);
      if (!open) continue;
      // The JSX element runs to its self-closing bracket (or matching close tag).
      let block = '';
      for (let j = i; j < Math.min(lines.length, i + 40); j++) {
        block += `${lines[j]}\n`;
        if (/\/>/.test(lines[j]) || new RegExp(`</${open[1]}>`).test(lines[j])) break;
      }
      const named = /\b(aria-label|ariaLabel)\b/.test(block);
      // A label on the same line, before the control: `<Field label=…>{(id) => <Input id={id} …`.
      const head = lines[i].slice(0, lines[i].search(/<(Input|Select|Textarea)\b/));
      const sameLine = /<Field\b/.test(head) || /<label\b/.test(head) || /htmlFor=/.test(head);
      // …or a label above the control: an open `Field` wrapper (it is closed
      // after the control) or an explicit `<label htmlFor=…>`.
      const above = lines.slice(Math.max(0, i - 30), i).join('\n');
      const insideField = /<Field\b/.test(above) && !/<\/Field>/.test(above.slice(above.lastIndexOf('<Field')));
      const explicitLabel = /htmlFor=/.test(above) || /<label\b/.test(above);
      if (named || sameLine || insideField || explicitLabel) continue;
      findings.push({
        file: path.relative(path.resolve(__dirname, '..', '..'), file).replace(/\\/g, '/'),
        line: i + 1,
        name: 'unlabelled control',
        control: lines[i].trim().slice(0, 120),
      });
    }
  }
  return findings;
}

describe('every renderer form control is labelled or explicitly named', () => {
  it('has no control without a visible label or an accessible name', () => {
    const findings = findUnlabelledControls();
    const report = findings.map((f) => `${f.file}:${f.line} → ${f.control}`).join('\n');
    expect(findings, `Unlabelled controls found:\n${report}`).toEqual([]);
  });

  it('keeps the medicine instruction field labelled in both prescription modules', () => {
    // The free-text line is the newest field; make sure neither module renders a
    // bare input for it (the shared component owns the label).
    for (const file of ['src/renderer/pages/Patients.tsx', 'src/renderer/pages/QuickDocuments.tsx']) {
      const source = fs.readFileSync(path.join(rendererRoot, '..', '..', file), 'utf8');
      expect(source, file).not.toMatch(/medicineInstruction[\s\S]{0,120}<Input(?![^>]*id=)/);
    }
  });

  it('does not hide a field label with CSS', () => {
    // `.field label { display: none }` (or any rule that removes a label from the
    // layout) would make this policy a lie while the markup still looked right.
    const css = fs.readFileSync(path.join(rendererRoot, 'styles', 'global.css'), 'utf8');
    const hiding = Array.from(css.matchAll(/\.field[^{]*label[^{]*\{[^}]*display:\s*none/g)).map((m) => m[0]);
    expect(hiding).toEqual([]);
  });
});
