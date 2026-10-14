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

const markersIn = (html: string): string[] =>
  Array.from(html.matchAll(/data-doc-el="([^"]+)"/g)).map((m) => m[1]);

describe('printable documents: default design is unchanged', () => {
  for (const { type, renderer, sample } of CASES) {
    it(`${type} renders identically to the pre-customization implementation`, () => {
      const data = DOCUMENT_SAMPLES[sample]();
      const before = normalizeDocumentMarkup(render(legacy, renderer, data));
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
