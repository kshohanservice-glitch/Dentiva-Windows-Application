import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { safeResolve } from '../../src/main/paths';
import { neutralizeFormula, csvEscape } from '../../src/shared/csv';

describe('safeResolve containment', () => {
  const root = path.resolve('/data/attachments');

  it('allows normal nested paths and names that merely start with two dots', () => {
    expect(safeResolve(root, 'patient', '1', 'scan.png')).toBe(path.join(root, 'patient', '1', 'scan.png'));
    expect(safeResolve(root, '..notes.txt')).toBe(path.join(root, '..notes.txt'));
  });

  it('rejects parent traversal, absolute replacements and the root\'s parent', () => {
    expect(() => safeResolve(root, '..', 'secret.db')).toThrow(/escapes/);
    expect(() => safeResolve(root, 'a', '..', '..', 'x')).toThrow(/escapes/);
    expect(() => safeResolve(root, path.resolve('/etc/passwd'))).toThrow(/escapes/);
  });

  it('rejects the root itself being treated as a parent escape', () => {
    expect(() => safeResolve(root, '..')).toThrow(/escapes/);
  });
});

describe('CSV formula neutralization', () => {
  it('neutralizes every OWASP trigger character, including leading TAB and CR', () => {
    for (const v of ['=SUM(1)', '+cmd', '-2+3', '@SUM(A1)', '\t=calc', '\r=calc']) {
      expect(neutralizeFormula(v).startsWith("'")).toBe(true);
    }
  });

  it('keeps plain numbers and ordinary text unchanged', () => {
    expect(neutralizeFormula('-1500')).toBe('-1500');
    expect(neutralizeFormula('12.50')).toBe('12.50');
    expect(neutralizeFormula('Rahim Uddin')).toBe('Rahim Uddin');
  });

  it('quotes cells containing separators or newlines after neutralization', () => {
    expect(csvEscape('=HYPERLINK("x,y")')).toBe(`"'=HYPERLINK(""x,y"")"`);
  });
});
