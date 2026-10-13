/**
 * Task B regression tests — Global Search result label / title overlap.
 *
 * The defect: `.search-hit .kind` inherited a stale `width: 64px` declaration
 * from an earlier, duplicated rule block, so the `APPOINTMENT` and
 * `PRESCRIPTION` badges overflowed their box and intruded into the result
 * title, and rows were not consistently aligned.
 *
 * The fix renders every row as a CSS Grid with two dedicated columns and a
 * single canonical rule block. These tests lock both the DOM structure and the
 * stylesheet contract in place.
 */
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
import path from 'node:path';

// The masked Money component needs the app context; the search modal only ever
// renders amounts through it, so stub the context hook for this DOM-level test.
vi.mock('../../src/renderer/state/app-context', () => ({
  useApp: () => ({ locked: false, user: { userId: 1 }, can: () => true }),
}));

import { SEARCH_KIND_LABELS, SearchHitRow, searchKindLabel } from '../../src/renderer/components/search-hit-row';
import type { SearchHit } from '../../src/shared/types';

const repoRoot = path.resolve(__dirname, '..', '..');
const css = fs.readFileSync(path.join(repoRoot, 'src/renderer/styles/global.css'), 'utf8').replace(/\r\n/g, '\n');

const ALL_KINDS = Object.keys(SEARCH_KIND_LABELS) as SearchHit['kind'][];

function hit(kind: SearchHit['kind'], patch: Partial<SearchHit> = {}): SearchHit {
  return { kind, id: 1, title: 'Title', subtitle: 'Subtitle', ...patch };
}

/** Every rule block whose selector list is exactly `.search-hit`. */
function searchHitRules(source: string): string[] {
  const blocks: string[] = [];
  const re = /(^|\n)\s*\.search-hit \{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const open = source.indexOf('{', m.index);
    const close = source.indexOf('}', open);
    blocks.push(source.slice(open, close));
  }
  return blocks;
}

function ruleBlock(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  expect(start, `rule "${selector} {" not found`).toBeGreaterThan(-1);
  const end = source.indexOf('}', start);
  return source.slice(start, end);
}

describe('search category labels', () => {
  it('covers every supported search result kind', () => {
    expect(ALL_KINDS.sort()).toEqual(
      ['appointment', 'dentist', 'expense', 'inventory', 'invoice', 'patient', 'payment', 'prescription', 'staff', 'treatment', 'visit'],
    );
  });

  it('falls back to a neutral label for an unknown kind', () => {
    expect(searchKindLabel('nope' as SearchHit['kind'])).toBe('Result');
  });
});

describe('search hit row DOM structure', () => {
  it('renders exactly two layout columns: category label and result content', () => {
    const html = renderToStaticMarkup(createElement(SearchHitRow, { hit: hit('patient'), selected: false, onOpen: () => undefined }));
    // The row has exactly two direct children.
    expect(html.startsWith('<button class="search-hit"')).toBe(true);
    expect(html).not.toContain('flex-1');
    const columns = html.match(/<span class="(kind|hit-body)"/g) ?? [];
    expect(columns).toEqual(['<span class="kind"', '<span class="hit-body"']);
  });

  it('keeps every category label inside its own column', () => {
    for (const kind of ALL_KINDS) {
      const html = renderToStaticMarkup(createElement(SearchHitRow, { hit: hit(kind), selected: false, onOpen: () => undefined }));
      expect(html).toContain(`<span class="kind">${SEARCH_KIND_LABELS[kind]}</span>`);
      expect(html).toContain('<span class="hit-body">');
      expect(html).not.toContain('flex-1');
    }
  });

  it('marks the keyboard-selected row and preserves the selection class', () => {
    const html = renderToStaticMarkup(createElement(SearchHitRow, { hit: hit('invoice'), selected: true, onOpen: () => undefined }));
    expect(html).toContain('class="search-hit selected"');
  });

  it('exposes the full title as a tooltip so an ellipsised title stays readable', () => {
    const long = 'A'.repeat(180);
    const html = renderToStaticMarkup(createElement(SearchHitRow, { hit: hit('patient', { title: long }), selected: false, onOpen: () => undefined }));
    expect(html).toContain(`title="${long}"`);
    expect(html).toContain(`>${long}</span>`);
  });

  it('renders long patient names, invoice ids and subtitles without structure loss', () => {
    const html = renderToStaticMarkup(createElement(SearchHitRow, {
      hit: hit('invoice', {
        title: 'Invoice INV-2026-000123 — Mohammad Abdul Karim Chowdhury',
        subtitle: 'Mohammad Abdul Karim Chowdhury',
        meta: '2026-10-13 · scheduled',
      }),
      selected: false,
      onOpen: () => undefined,
    }));
    expect(html).toContain('Invoice INV-2026-000123 — Mohammad Abdul Karim Chowdhury');
    expect(html).toContain('Mohammad Abdul Karim Chowdhury · 2026-10-13 · scheduled');
    expect((html.match(/<span class="kind"/g) ?? []).length).toBe(1);
    expect((html.match(/<span class="hit-body"/g) ?? []).length).toBe(1);
  });
});

describe('search stylesheet contract', () => {
  it('declares a single canonical .search-hit rule (no conflicting duplicates)', () => {
    // The layout itself must be declared exactly once; a responsive override may
    // only tune spacing, never re-declare the columns.
    const rowRules = searchHitRules(css);
    expect(rowRules.length).toBeGreaterThan(0);
    expect(rowRules.filter((b) => /display:\s*grid/.test(b)).length).toBe(1);
    expect(rowRules.filter((b) => /grid-template-columns/.test(b)).length).toBe(1);
    expect(css.match(/\.search-hit \.kind \{/g)?.length).toBe(1);
    expect(css.match(/\.search-hit \.hit-body \{/g)?.length).toBe(1);
  });

  it('lays the row out as a grid with two dedicated columns', () => {
    const block = ruleBlock(css, '.search-hit');
    expect(block).toContain('display: grid');
    const columns = /grid-template-columns:\s*([^;]+);/.exec(block)?.[1] ?? '';
    // Split on top-level whitespace only, so `minmax(0, 1fr)` stays one track.
    const tracks = columns.trim().split(/\s+(?![^(]*\))/);
    expect(tracks.length).toBe(2);
    // Column 1 is a fixed track; column 2 is the flexible content track.
    expect(/^\d+px$/.test(tracks[0])).toBe(true);
    expect(tracks[1]).toBe('minmax(0, 1fr)');
  });

  it('never constrains the category label with a hard width (the original defect)', () => {
    const block = ruleBlock(css, '.search-hit .kind');
    expect(block).not.toMatch(/(?<![-w])width\s*:/);
    expect(block).not.toContain('flex: none');
    expect(block).toContain('min-width: 0');
    expect(block).toContain('overflow: hidden');
    expect(block).toContain('text-overflow: ellipsis');
    expect(block).toContain('white-space: nowrap');
    // The width bound below assumes the badge is rendered in small caps.
    expect(block).toContain('text-transform: uppercase');
  });

  it('lets the content column shrink instead of widening the row', () => {
    const body = ruleBlock(css, '.search-hit .hit-body');
    expect(body).toContain('min-width: 0');
    for (const sel of ['.search-hit .title', '.search-hit .sub']) {
      const b = ruleBlock(css, sel);
      expect(b).toContain('min-width: 0');
      expect(b).toContain('overflow: hidden');
      expect(b).toContain('text-overflow: ellipsis');
    }
  });

  it('excludes search results from the shell-wide title-case transform', () => {
    const exclusion = /\.shell \.search-results/.exec(css);
    expect(exclusion).not.toBeNull();
  });

  it('keeps the search modal inside the viewport', () => {
    expect(ruleBlock(css, '.search-modal')).toContain('max-width: min(640px, 100%)');
  });
});

describe('category label fits its column (conservative estimate)', () => {
  /**
   * Conservative upper bound on rendered label width. Uppercase Inter at
   * weight 800 advances roughly 0.70em per glyph and `letter-spacing: 0.05em`
   * is added after every character. This is an explicit bound, not a
   * pixel-accurate measurement — real rendering is verified on Windows.
   */
  const FONT_SIZE_PX = 10;
  const AVG_GLYPH_EM = 0.7;
  const LETTER_SPACING_EM = 0.05;
  const PADDING_PX = 10; // 3px top/bottom + 5px left/right, horizontal only

  it('the widest label (PRESCRIPTION) fits the fixed column', () => {
    const track = Number(/grid-template-columns:\s*(\d+)px/.exec(ruleBlock(css, '.search-hit'))?.[1]);
    const contentWidth = track - PADDING_PX;
    for (const label of Object.values(SEARCH_KIND_LABELS)) {
      const estimated = label.length * (FONT_SIZE_PX * AVG_GLYPH_EM + FONT_SIZE_PX * LETTER_SPACING_EM);
      expect(estimated, `label "${label}" would overflow its column`).toBeLessThanOrEqual(contentWidth);
    }
  });
});
