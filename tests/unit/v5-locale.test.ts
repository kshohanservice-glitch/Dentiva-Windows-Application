/**
 * V5-033 — dates and times read the same way on every PC.
 *
 * Dentiva Pro formats dates as dd/mm/yyyy and times as 24-hour HH:MM itself
 * (formatDate, wallClockTime). Native date fields are drawn by Chromium instead.
 * On Windows it uses the PC's own short date format whenever the app language
 * and the Windows regional format are both English (Blink locale_win.cc returns
 * LOCALE_USER_DEFAULT), so an English (US) PC shows mm/dd/yyyy and no app
 * locale switch changes that. Windows CI run 38757316130 confirmed it: with
 * --lang=en-GB the field still read Month, Day, Year. So the app spells the
 * chosen date out under each date field, and nothing it formats itself depends
 * on the machine locale. tests/e2e/app.spec.ts checks the read-back in the
 * running app on Windows CI.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createElement, type FunctionComponent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { clockTime12, formatDate, formatDateLong, wallClockTime } from '../../src/renderer/format';
import { Field, Input } from '../../src/renderer/components/forms';
import { appointmentCardDoc } from '../../src/renderer/documents/print-documents';
import { DOCUMENT_SAMPLES, stripDocumentMarkers } from '../../src/renderer/documents/samples';

const ROOT = path.resolve(__dirname, '../..');
// Windows checkouts may use CRLF line endings.
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(rel);
    return /\.(ts|tsx)$/.test(entry.name) ? [rel] : [];
  });
}

describe('V5-033: date fields spell out the chosen date', () => {
  const field = (type: string, value: string): string =>
    renderToStaticMarkup(
      createElement(Field, { label: 'Date', children: (id: string) => createElement(Input, { id, type, value, onChange: () => undefined }) }),
    );
  const echoOf = (html: string): { id?: string; text?: string; describedBy?: string } => {
    const echo = /<div class="date-echo" id="([^"]+)">([^<]*)<\/div>/.exec(html);
    return { id: echo?.[1], text: echo?.[2], describedBy: / aria-describedby="([^"]+)"/.exec(html)?.[1] };
  };

  it('a date field shows the date in words and is described by it', () => {
    const echo = echoOf(field('date', '2026-04-03'));
    expect(echo.text).toBe('Fri 3 Apr 2026');
    expect(echo.id).toBeTruthy();
    expect(echo.describedBy).toBe(echo.id);
  });

  it('a date-and-time field shows the date in words with the 24-hour time', () => {
    expect(echoOf(field('datetime-local', '2026-03-04T14:30')).text).toBe('Wed 4 Mar 2026, 14:30');
  });

  it('shows nothing for an empty date field or for other field types', () => {
    for (const html of [field('date', ''), field('text', '2026-04-03'), field('time', '14:30')]) {
      expect(html).not.toContain('date-echo');
      expect(html).not.toContain('aria-describedby');
    }
  });

  it('formatDateLong spells out real dates only', () => {
    expect(formatDateLong('2026-04-03')).toBe('Fri 3 Apr 2026');
    expect(formatDateLong('2026-03-04')).toBe('Wed 4 Mar 2026');
    expect(formatDateLong('2024-02-29')).toBe('Thu 29 Feb 2024');
    expect(formatDateLong('1990-12-31')).toBe('Mon 31 Dec 1990');
    expect(formatDateLong('2026-10-15T09:05')).toBe('Thu 15 Oct 2026, 09:05');
    expect(formatDateLong('2026-10-15T09:05:00.000Z')).toBe('Thu 15 Oct 2026, 09:05');
    for (const bad of [null, undefined, '', '2025-02-29', '2026-13-01', '2026-00-10', '15/10/2026', 'today']) {
      expect(formatDateLong(bad), String(bad)).toBe('');
    }
  });

  it('every form date field goes through the shared Input component', () => {
    // Raw <input type="date"> elements are allowed only in the filter bars,
    // which never save a date.
    const isComment = (line: string): boolean => /^\s*(\/\/|\/\*|\*)/.test(line);
    const raw = sourceFiles('src/renderer').flatMap((rel) =>
      read(rel).split('\n').flatMap((line) => (!isComment(line) && /<input\b[^>]*type="(date|datetime-local)"/.test(line) ? [rel] : [])),
    );
    expect(raw.map((rel) => rel.replace(/\\/g, '/')).sort()).toEqual([
      'src/renderer/pages/Accounting.tsx', 'src/renderer/pages/Accounting.tsx',
      'src/renderer/pages/Audit.tsx', 'src/renderer/pages/Audit.tsx',
      'src/renderer/pages/Reports.tsx', 'src/renderer/pages/Reports.tsx',
    ]);
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
