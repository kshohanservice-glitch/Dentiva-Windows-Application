/**
 * V5-033 — dates and times read the same way everywhere.
 *
 * Dentiva Pro formats dates as dd/mm/yyyy and times as 24-hour HH:MM itself
 * (formatDate, wallClockTime). Native date and time inputs are drawn by
 * Chromium in its UI locale instead, which follows the Windows language settings:
 * mm/dd/yyyy and AM/PM on English (US). The main process pins that locale to
 * en-GB. These tests cover what can be checked without a Windows desktop;
 * tests/e2e/app.spec.ts reads the field order from the running Electron app
 * on Windows CI.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createElement, type FunctionComponent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { clockTime12, formatDate, wallClockTime } from '../../src/renderer/format';
import { appointmentCardDoc } from '../../src/renderer/documents/print-documents';
import { DOCUMENT_SAMPLES, stripDocumentMarkers } from '../../src/renderer/documents/samples';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(rel);
    return /\.(ts|tsx)$/.test(entry.name) ? [rel] : [];
  });
}

describe('V5-033: Chromium UI locale', () => {
  it('is pinned to en-GB at module top level, before the app is ready', () => {
    const src = read('src/main/index.ts');
    const pin = src.indexOf("\napp.commandLine.appendSwitch('lang', 'en-GB');\n");
    expect(pin, 'the switch must be a top-level statement in src/main/index.ts').toBeGreaterThan(0);
    const ready = src.indexOf('app.whenReady(');
    expect(ready).toBeGreaterThan(0);
    expect(pin).toBeLessThan(ready);
    expect(src).not.toContain("app.on('ready'");
  });

  it('is also used by the layout harness, so its screenshots match the app', () => {
    const harness = read('scripts/layout-audit.mjs');
    expect(harness).toContain("'--lang=en-GB'");
    expect(harness).toContain("LANG: 'en_GB.UTF-8'");
  });
});

describe('V5-033: no formatting depends on the machine locale', () => {
  // toLocale*String() / toLocale*String(undefined, …) / Intl.X() / Intl.X(undefined, …)
  const DEFAULT_LOCALE = /toLocale(?:Date|Time)?String\(\s*(?:undefined\s*[,)]|\))|Intl\.[A-Za-z]+\(\s*(?:undefined\s*[,)]|\))/;

  it('the pattern catches the forms it is meant to catch', () => {
    for (const bad of ['d.toLocaleTimeString(undefined, { hour: "2-digit" })', 'n.toLocaleString()', 'new Intl.DateTimeFormat()', 'Intl.NumberFormat(undefined, {})']) {
      expect(DEFAULT_LOCALE.test(bad), bad).toBe(true);
    }
    for (const ok of ["d.toLocaleTimeString('en-GB', {})", "n.toLocaleString('en-GB')", "new Intl.DateTimeFormat('en-GB', { timeZone })", 'a.localeCompare(b, undefined, { numeric: true })']) {
      expect(DEFAULT_LOCALE.test(ok), ok).toBe(false);
    }
  });

  it('no source file in src/ formats with the default locale', () => {
    const files = sourceFiles('src');
    expect(files.length).toBeGreaterThan(50);
    const offenders = files.flatMap((rel) =>
      read(rel).split('\n').flatMap((line, i) => (DEFAULT_LOCALE.test(line) ? [`${rel}:${i + 1}`] : [])),
    );
    expect(offenders).toEqual([]);
  });
});

describe('V5-033: clock formats', () => {
  it('clockTime12 gives the English (US) 12-hour look', () => {
    expect(clockTime12('00:00')).toBe('12:00 AM');
    expect(clockTime12('09:05')).toBe('09:05 AM');
    expect(clockTime12('11:59')).toBe('11:59 AM');
    expect(clockTime12('12:00')).toBe('12:00 PM');
    expect(clockTime12('14:30')).toBe('02:30 PM');
    expect(clockTime12('23:59')).toBe('11:59 PM');
    expect(clockTime12('14:30:15')).toBe('02:30 PM');
  });

  it('clockTime12 returns an empty string for anything that is not HH:MM', () => {
    for (const bad of [null, undefined, '', '9:05', '24:00', '12:60', 'noon']) expect(clockTime12(bad), String(bad)).toBe('');
  });

  it('matches what an English (US) PC printed before', () => {
    for (const [h, m] of [[0, 0], [9, 5], [12, 0], [14, 30], [23, 59]]) {
      const before = new Date(2026, 9, 15, h, m).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      const hhmm = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      // Some ICU versions put a narrow no-break space before AM/PM.
      expect(clockTime12(hhmm)).toBe(before.replace(/\s/g, ' '));
    }
  });

  it('the app-wide helpers stay dd/mm/yyyy and 24-hour', () => {
    expect(formatDate('2026-04-03')).toBe('03/04/2026');
    expect(wallClockTime('2026-04-03T14:30:00')).toBe('14:30');
  });
});

describe('V5-033: printed appointment card time', () => {
  const card = (time: string | null): string => {
    const data = DOCUMENT_SAMPLES['appointment-card']();
    data.appointment.time = time;
    return stripDocumentMarkers(renderToStaticMarkup(createElement(appointmentCardDoc as FunctionComponent<any>, data)));
  };
  const timeValue = (html: string): string | undefined =>
    /<span class="k">Time<\/span><span class="v">([^<]*)<\/span>/.exec(html)?.[1];

  it('prints a fixed 12-hour time, whatever the machine locale', () => {
    expect(timeValue(card('14:30'))).toBe('02:30 PM');
    expect(timeValue(card('09:05'))).toBe('09:05 AM');
    expect(timeValue(card('00:00'))).toBe('12:00 AM');
  });

  it('prints a dash when the time is missing', () => {
    expect(timeValue(card(null))).toBe('—');
    expect(timeValue(card(''))).toBe('—');
  });

  it('still prints the date as dd/mm/yyyy', () => {
    expect(card('14:30')).toContain('22/06/2026');
  });
});
