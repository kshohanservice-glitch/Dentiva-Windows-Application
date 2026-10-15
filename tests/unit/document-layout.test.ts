/**
 * Layout-preservation regression test for the document-customization feature.
 *
 * The product rule is: *original design + validated overrides = final document*.
 * A clinic that has customized nothing must get exactly the document it got
 * before this feature existed — no new elements, no changed classes, no changed
 * inline styles, no re-ordering.
 *
 * `tests/fixtures/legacy-print-documents.tsx` is a frozen copy of the original
 * renderers (generated from commit 58375e0). This test renders each document
 * through both implementations with identical sample data and requires the
 * markup to be identical. The only difference allowed is the `data-doc-el`
 * attribute, which adds no element and no style and is stripped before the
 * comparison — and it is asserted to be the *only* difference.
 *
 * The second half of the file proves the customization registry and the
 * renderers stay in step: every declared element must actually be rendered (so
 * no customization option is dead), every rendered marker must be declared (so
 * a marker can never be styled by accident), and an untouched document must
 * generate no stylesheet at all.
 */
import { describe, expect, it } from 'vitest';
import { createElement, type FunctionComponent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as legacy from '../fixtures/legacy-print-documents';
import * as current from '../../src/renderer/documents/print-documents';
import {
  DOCUMENT_SAMPLES, normalizeDocumentMarkup, stripDocumentMarkers,
} from '../../src/renderer/documents/samples';
import {
  DOCUMENT_TYPE_DEFS, documentStyleCss, elementDef, normalizeDocumentStyles,
  type CustomizableDocumentType,
} from '../../src/shared/document-styles';

/** document type → sample payload factory + renderer exported by both modules. */
const CASES: { type: CustomizableDocumentType; renderer: string; sample: string }[] = [
  { type: 'prescription', renderer: 'prescriptionDoc', sample: 'prescription' },
  { type: 'invoice', renderer: 'invoiceDoc', sample: 'invoice' },
  { type: 'receipt', renderer: 'receiptDoc', sample: 'receipt' },
  { type: 'visit-summary', renderer: 'visitSummaryDoc', sample: 'visit-summary' },
  { type: 'appointment-card', renderer: 'appointmentCardDoc', sample: 'appointment-card' },
  { type: 'stock-labels', renderer: 'stockLabelDoc', sample: 'stock-labels' },
  { type: 'report', renderer: 'reportDoc', sample: 'report' },
];

const render = (mod: Record<string, any>, name: string, data: unknown): string =>
  renderToStaticMarkup(createElement(mod[name] as FunctionComponent<any>, data));

/**
 * The frozen copy formats the appointment-card time with the machine's default
 * locale ("10:30 AM" on English (US), "10:30" on English (UK)). v5 prints a
 * fixed 12-hour time in the English (US) style (clockTime12, V5-033), so the
 * frozen side is rendered with en-US. The comparison then doesn't depend on the
 * test machine, and it checks that v5 prints what an English (US) PC printed.
 */
function renderLegacy(name: string, data: unknown): string {
  const original = Date.prototype.toLocaleTimeString;
  Date.prototype.toLocaleTimeString = function (this: Date, _locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
    return original.call(this, 'en-US', options);
  };
  try {
    return render(legacy, name, data);
  } finally {
    Date.prototype.toLocaleTimeString = original;
  }
}

const markersIn = (html: string): string[] =>
  Array.from(html.matchAll(/data-doc-el="([^"]+)"/g)).map((m) => m[1]);

describe('printable documents: default design is unchanged', () => {
  for (const { type, renderer, sample } of CASES) {
    it(`${type} renders identically to the pre-customization implementation`, () => {
      const data = DOCUMENT_SAMPLES[sample]();
      const before = normalizeDocumentMarkup(renderLegacy(renderer, data));
      const after = normalizeDocumentMarkup(render(current, renderer, data));
      // Markers are the only difference …
      expect(stripDocumentMarkers(after)).toBe(before);
      // … and they are present (otherwise this test would pass vacuously).
      expect(markersIn(after).length).toBeGreaterThan(0);
      // No style attribute is introduced anywhere by tagging.
      const styleAttributes = (html: string) => Array.from(html.matchAll(/ style="([^"]*)"/g)).map((m) => m[1]);
      expect(styleAttributes(after)).toEqual(styleAttributes(before));
    });
  }

  it('a duplicate prescription differs only by the specimen watermark', () => {
    const data = DOCUMENT_SAMPLES['prescription-duplicate']();
    const html = normalizeDocumentMarkup(render(current, 'prescriptionDoc', data));
    expect(html).toContain('print-watermark');
    expect(html).toContain('Specimen');
  });

  it('prints a nonblank one-line medicine instruction instead of duplicate structured directions', () => {
    const data = DOCUMENT_SAMPLES.prescription() as any;
    data.rx.items[0] = {
      ...data.rx.items[0],
      medicineInstruction: 'Take one capsule after meals for five days.',
    };
    const html = render(current, 'prescriptionDoc', data);
    expect(html).toContain('class="medication-single-instruction">Take one capsule after meals for five days.</span>');
    expect(html).not.toContain('1 capsule');
    expect(html).not.toContain('3× daily');
    expect(html).toContain('Amoxicillin trihydrate');
    expect(html).toContain('2× daily');
  });

  it('an untouched installation emits no customization stylesheet', () => {
    expect(documentStyleCss({})).toBe('');
    expect(documentStyleCss(undefined)).toBe('');
    expect(documentStyleCss(normalizeDocumentStyles(null))).toBe('');
  });
});

describe('document customization registry ↔ renderers', () => {
  for (const { type, renderer, sample } of CASES) {
    it(`every ${type} element is rendered and every marker is declared`, () => {
      const html = render(current, renderer, DOCUMENT_SAMPLES[sample]());
      const rendered = new Set(markersIn(html));
      const declared = DOCUMENT_TYPE_DEFS.find((d) => d.type === type)!.elements.map((e) => e.id);

      const deadOptions = declared.filter((id) => !rendered.has(id));
      expect(deadOptions, `declared but never rendered: ${deadOptions.join(', ')}`).toEqual([]);

      const undeclared = [...rendered].filter((id) => !elementDef(id) || !id.startsWith(`${type}.`));
      expect(undeclared, `rendered but not declared: ${undeclared.join(', ')}`).toEqual([]);
    });
  }

  it('element ids are unique across the whole registry', () => {
    const ids = DOCUMENT_TYPE_DEFS.flatMap((d) => d.elements.map((e) => e.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('offers visibility exactly for the elements that may be hidden', () => {
    for (const def of DOCUMENT_TYPE_DEFS) {
      for (const element of def.elements) {
        // A visibility control exists only where hiding is allowed …
        if (element.props.includes('visible')) expect(element.optional, element.id).toBe(true);
        // … and every element declared optional must offer it.
        if (element.optional) expect(element.props.includes('visible'), element.id).toBe(true);
      }
    }
  });
});
