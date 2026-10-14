/**
 * Feature A unit tests — the printable-document customization model.
 *
 * The model must be safe by construction:
 *   - unknown documents / elements / properties are dropped (never applied),
 *   - numbers are clamped into ranges that cannot break a layout,
 *   - colours must be hex; anything else falls back to the original design,
 *   - required content cannot be hidden; only declared-optional elements can,
 *   - validation never throws, whatever the stored JSON looks like,
 *   - an untouched configuration produces an empty stylesheet, which is what
 *     keeps the original designs byte-identical by default.
 */
import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_FONTS, DOCUMENT_SECTIONS, DOCUMENT_SECTION_LABELS, DOCUMENT_TYPE_DEFS,
  countDocumentOverrides, customizedDocumentTypes, documentStyleCss, documentTypeDef, docEl,
  elementDef, elementsOf, isValidHexColor, normalizeDocumentStyles, normalizeElementStyle,
  normalizeHexColor, propDef, resetAllDocuments, resetDocument, resetElement, resetSection,
  type DocumentStyleMap,
} from '../../src/shared/document-styles';

const allElementIds = DOCUMENT_TYPE_DEFS.flatMap((d) => d.elements.map((e) => e.id));

describe('registry', () => {
  it('covers every printable document the application produces', () => {
    expect(DOCUMENT_TYPE_DEFS.map((d) => d.type).sort()).toEqual([
      'appointment-card', 'invoice', 'prescription', 'receipt', 'report', 'stock-labels', 'visit-summary',
    ]);
  });

  it('gives every element a label, a section and at least one property', () => {
    for (const def of DOCUMENT_TYPE_DEFS) {
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(0);
      for (const element of def.elements) {
        expect(element.label.length).toBeGreaterThan(0);
        expect(DOCUMENT_SECTIONS).toContain(element.section);
        expect(element.props.length).toBeGreaterThan(0);
        expect(element.id.startsWith(`${def.type}.`)).toBe(true);
      }
    }
  });

  it('exposes element lookup helpers', () => {
    expect(elementDef('invoice.header.clinicName')?.label).toBe('Clinic name');
    expect(elementDef('nope.nope.nope')).toBeUndefined();
    expect(documentTypeDef('invoice').elements.length).toBeGreaterThan(0);
    for (const section of DOCUMENT_SECTIONS) {
      expect(elementsOf('prescription', section).every((e) => e.section === section)).toBe(true);
    }
    expect(DOCUMENT_SECTION_LABELS.tables).toBeTruthy();
  });

  it('describes each property for the settings UI', () => {
    expect(propDef('color').control).toBe('color');
    expect(propDef('fontSize')).toMatchObject({ control: 'number', min: 6, max: 48 });
    expect(propDef('fontWeight')).toMatchObject({ control: 'number', min: 100, max: 900 });
    expect(propDef('fontFamily').options?.map((o) => o.value).sort()).toEqual(Object.keys(DOCUMENT_FONTS).sort());
    expect(propDef('textAlign').options?.map((o) => o.value)).toEqual(['left', 'center', 'right']);
    expect(propDef('visible').control).toBe('toggle');
  });
});

describe('docEl()', () => {
  it('emits only the stable marker attribute, no class or style', () => {
    expect(docEl('invoice.body.title')).toEqual({ 'data-doc-el': 'invoice.body.title' });
  });

  it('uses ids that are present in the registry and never derived from content', () => {
    for (const id of allElementIds) {
      expect(id).toMatch(/^[a-z-]+\.[a-z]+(\.[A-Za-z]+)+$/);
      expect(elementDef(id)).toBeDefined();
    }
  });
});

describe('normalizeDocumentStyles — untrusted input', () => {
  it('accepts a valid override and keeps it', () => {
    const raw = { invoice: { 'invoice.body.title': { fontSize: 18, color: '#112233', textAlign: 'center' } } };
    expect(normalizeDocumentStyles(raw)).toEqual(raw);
  });

  it('never throws on hostile input', () => {
    const hostile: unknown[] = [
      null, undefined, 0, 'x', [], true,
      { invoice: null }, { invoice: [] }, { invoice: 'nope' }, { invoice: { 'invoice.body.title': 5 } },
      { nope: { nope: { color: '#fff' } } },
      JSON.parse('{"__proto__":{"polluted":true}}'),
      { invoice: JSON.parse('{"__proto__":{"invoice.body.title":{"fontSize":99}}}') },
    ];
    for (const value of hostile) {
      expect(() => normalizeDocumentStyles(value)).not.toThrow();
      expect(normalizeDocumentStyles(value)).toBeTypeOf('object');
    }
  });

  it('drops unknown documents, elements and properties', () => {
    const normalized = normalizeDocumentStyles({
      invoice: {
        'invoice.body.title': { fontSize: 20 },
        'invoice.notAnElement': { fontSize: 20 },
        'prescription.body.rxSymbol': { fontSize: 20 },
      },
      notADocument: { 'invoice.body.title': { fontSize: 20 } },
    });
    expect(normalized).toEqual({ invoice: { 'invoice.body.title': { fontSize: 20 } } });
  });

  it('ignores properties an element does not declare', () => {
    // Column widths are per column; a colour on a column element is not offered
    // and must not be stored.
    const normalized = normalizeDocumentStyles({ invoice: { 'invoice.tables.colQty': { color: '#ff0000', columnWidth: 12 } } });
    expect(normalized).toEqual({ invoice: { 'invoice.tables.colQty': { columnWidth: 12 } } });
  });

  it('clamps out-of-range numbers instead of storing them', () => {
    const normalized = normalizeDocumentStyles({
      prescription: {
        'prescription.body.rxSymbol': { fontSize: 500, lineHeight: -4, letterSpacing: 99 },
        'prescription.body.patientStrip': { marginTop: 1e6, paddingLeft: -5, borderBottomWidth: 99 },
      },
    });
    const symbol = normalized.prescription!['prescription.body.rxSymbol'];
    expect(symbol.fontSize).toBe(48);
    expect(symbol.lineHeight).toBe(0.8);
    expect(symbol.letterSpacing).toBe(5);
    const strip = normalized.prescription!['prescription.body.patientStrip'];
    expect(strip.marginTop).toBe(40);
    expect(strip.paddingLeft).toBe(0);
    expect(strip.borderBottomWidth).toBe(4);
  });

  it('rounds font weight to the nearest hundred and rejects non-numeric values', () => {
    expect(normalizeElementStyle({ props: ['fontWeight'] }, { fontWeight: 433 })?.fontWeight).toBe(400);
    expect(normalizeElementStyle({ props: ['fontWeight'] }, { fontWeight: 700 })?.fontWeight).toBe(700);
    expect(normalizeElementStyle({ props: ['fontSize'] }, { fontSize: 'huge' })).toBeUndefined();
    expect(normalizeElementStyle({ props: ['fontSize'] }, { fontSize: null })).toBeUndefined();
  });

  it('accepts only hex colours, normalized to lowercase', () => {
    expect(isValidHexColor('#FFF')).toBe(true);
    expect(isValidHexColor('#ff8800')).toBe(true);
    expect(isValidHexColor('red')).toBe(false);
    expect(isValidHexColor('url(javascript:alert(1))')).toBe(false);
    expect(isValidHexColor('expression(alert(1))')).toBe(false);
    expect(normalizeHexColor('  #AABBCC ')).toBe('#aabbcc');
    const normalized = normalizeDocumentStyles({
      invoice: {
        'invoice.tables.head': { color: 'red; background: url(http://evil)', backgroundColor: '#ABCDEF' },
      },
    });
    expect(normalized.invoice!['invoice.tables.head']).toEqual({ backgroundColor: '#abcdef' });
  });

  it('accepts only known fonts and alignments', () => {
    expect(normalizeElementStyle({ props: ['fontFamily'] }, { fontFamily: 'serif' })?.fontFamily).toBe('serif');
    expect(normalizeElementStyle({ props: ['fontFamily'] }, { fontFamily: 'Comic Sans MS' })).toBeUndefined();
    expect(normalizeElementStyle({ props: ['textAlign'] }, { textAlign: 'justify' })).toBeUndefined();
    expect(normalizeElementStyle({ props: ['borderBottomStyle'] }, { borderBottomStyle: 'double' })).toBeUndefined();
  });

  it('hides only elements that are declared optional', () => {
    const optional = elementDef('prescription.header.clinicNameBn')!;
    expect(optional.optional).toBe(true);
    expect(normalizeElementStyle(optional, { visible: false })).toEqual({ visible: false });

    const required = elementDef('prescription.header.clinicName')!;
    expect(required.optional).toBeUndefined();
    expect(normalizeElementStyle(required, { visible: false })).toBeUndefined();
    expect(normalizeDocumentStyles({ prescription: { 'prescription.header.clinicName': { visible: false } } })).toEqual({});
  });

  it('ignores visible:true (it is the original state, not an override)', () => {
    expect(normalizeElementStyle({ props: ['visible'], optional: true }, { visible: true })).toBeUndefined();
  });

  it('drops empty overrides so a saved configuration stays meaningful', () => {
    expect(normalizeDocumentStyles({ invoice: { 'invoice.body.title': {} } })).toEqual({});
    expect(normalizeDocumentStyles({ invoice: {} })).toEqual({});
  });
});

describe('documentStyleCss', () => {
  it('returns an empty string when nothing is customized', () => {
    expect(documentStyleCss({})).toBe('');
    expect(documentStyleCss(null)).toBe('');
    expect(documentStyleCss(undefined)).toBe('');
  });

  it('scopes every rule to the tagged element inside a printable document', () => {
    const css = documentStyleCss({ invoice: { 'invoice.body.title': { fontSize: 18, color: '#101010' } } });
    expect(css).toBe('.print-doc [data-doc-el="invoice.body.title"] { color: #101010 !important; font-size: 18px !important; }');
    // The rule can only ever match inside a document …
    expect(css.startsWith('.print-doc [data-doc-el=')).toBe(true);
    // … and never leaks into application screens.
    expect(css).not.toMatch(/^\s*(body|html|\.shell|\.page)\b/m);
  });

  it('emits a descendant rule for table cell groups', () => {
    const css = documentStyleCss({ invoice: { 'invoice.tables.head': { backgroundColor: '#eeeeee' } } });
    expect(css).toBe('.print-doc [data-doc-el="invoice.tables.head"] th { background-color: #eeeeee !important; }');
  });

  it('styles only the elements the clinic changed', () => {
    const css = documentStyleCss({
      invoice: { 'invoice.body.title': { fontSize: 18 } },
      report: { 'report.body.title': { fontSize: 22 } },
    });
    expect(css).toContain('"invoice.body.title"');
    expect(css).toContain('"report.body.title"');
    expect(css).not.toContain('"invoice.footer.text"');
    expect(css.split('\n')).toHaveLength(2);
  });

  it('translates every supported property into CSS', () => {
    const css = documentStyleCss({
      invoice: {
        'invoice.body.title': {
          color: '#000000', backgroundColor: '#ffffff', fontSize: 16, fontWeight: 600, fontFamily: 'serif',
          textAlign: 'right', lineHeight: 1.6, letterSpacing: 0.5, marginTop: 4, marginRight: 3,
          marginBottom: 2, marginLeft: 1, paddingTop: 5, paddingRight: 6, paddingBottom: 7, paddingLeft: 8,
          borderBottomWidth: 2, borderBottomStyle: 'dashed', borderBottomColor: '#333333',
        },
      },
    });
    for (const declaration of [
      'color: #000000', 'background-color: #ffffff', 'font-size: 16px', 'font-weight: 600',
      "font-family: Georgia, 'Times New Roman', serif", 'text-align: right', 'line-height: 1.6',
      'letter-spacing: 0.5px', 'margin-top: 4px', 'margin-right: 3px', 'margin-bottom: 2px', 'margin-left: 1px',
      'padding-top: 5px', 'padding-right: 6px', 'padding-bottom: 7px', 'padding-left: 8px',
      'border-bottom-width: 2px', 'border-bottom-style: dashed', 'border-bottom-color: #333333',
    ]) {
      expect(css).toContain(`${declaration} !important`);
    }
  });

  it('hides an optional element with display:none', () => {
    const css = documentStyleCss({ invoice: { 'invoice.header.logo': { visible: false } } });
    expect(css).toBe('.print-doc [data-doc-el="invoice.header.logo"] { display: none !important; }');
  });

  it('renders a column width as a percentage of the table', () => {
    expect(documentStyleCss({ invoice: { 'invoice.tables.colQty': { columnWidth: 10 } } }))
      .toBe('.print-doc [data-doc-el="invoice.tables.colQty"] { width: 10% !important; }');
  });

  it('never emits a declaration for a value the model rejected', () => {
    const stored = normalizeDocumentStyles({ invoice: { 'invoice.body.title': { color: 'javascript:alert(1)', fontSize: 9999 } } });
    const css = documentStyleCss(stored);
    expect(css).not.toContain('javascript');
    expect(css).toContain('font-size: 48px');
  });
});

describe('resets', () => {
  const configured: DocumentStyleMap = {
    invoice: { 'invoice.body.title': { fontSize: 18 }, 'invoice.tables.head': { backgroundColor: '#eeeeee' } },
    prescription: { 'prescription.body.rxSymbol': { fontSize: 20 } },
  };

  it('resets one element', () => {
    const next = resetElement(configured, 'invoice', 'invoice.body.title');
    expect(next.invoice).toEqual({ 'invoice.tables.head': { backgroundColor: '#eeeeee' } });
    expect(configured.invoice!['invoice.body.title']).toBeDefined(); // input untouched
  });

  it('drops the document entry when its last element is reset', () => {
    const next = resetElement({ invoice: { 'invoice.body.title': { fontSize: 18 } } }, 'invoice', 'invoice.body.title');
    expect(next).toEqual({});
  });

  it('resets a section without touching other sections', () => {
    const next = resetSection(configured, 'invoice', 'tables');
    expect(next.invoice).toEqual({ 'invoice.body.title': { fontSize: 18 } });
    expect(next.prescription).toBeDefined();
  });

  it('resets a whole document and everything at once', () => {
    expect(resetDocument(configured, 'invoice')).toEqual({ prescription: { 'prescription.body.rxSymbol': { fontSize: 20 } } });
    expect(resetAllDocuments()).toEqual({});
  });

  it('counts overrides per document for the UI summary', () => {
    expect(countDocumentOverrides(configured, 'invoice')).toBe(2);
    expect(countDocumentOverrides(configured, 'receipt')).toBe(0);
    expect(customizedDocumentTypes(configured).sort()).toEqual(['invoice', 'prescription']);
  });
});
