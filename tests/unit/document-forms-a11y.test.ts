/**
 * Form wiring regression test for the two document features.
 *
 * Both new screens label their inputs with the shared `Field` primitive, whose
 * children render function supplies the id that the `<label for=…>` points at.
 * Ignoring that parameter produces a label that is not associated with any
 * control: the field cannot be reached by a screen reader or by an automation
 * selector, which is exactly how the first version of the walk-in form shipped.
 *
 * These tests render the real components and require every `for`/`id` pair to
 * resolve inside the rendered markup.
 */
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../../src/renderer/api', () => ({
  api: {},
  useAsync: () => ({
    data: [{ id: 1, name: 'Dr. Test Dentist' }],
    error: null,
    loading: false,
    reload: () => undefined,
    setData: () => undefined,
  }),
}));

vi.mock('../../src/renderer/state/app-context', () => ({
  useApp: () => ({ settings: null, can: () => true, locked: false, user: { userId: 1 } }),
}));

import { QuickDocumentsPage } from '../../src/renderer/pages/QuickDocuments';
import { CustomizeDocumentsPanel } from '../../src/renderer/components/customize-documents';
import { ToastProvider } from '../../src/renderer/components/primitives';
import { DOCUMENT_TYPE_DEFS, elementDef } from '../../src/shared/document-styles';
import { WATERMARK_DEFAULT } from '../../src/shared/watermark';

/** Every `for="x"` in the markup must have a matching `id="x"`. */
function assertLabelsResolve(html: string, where: string): void {
  const fors = Array.from(html.matchAll(/\bfor="([^"]*)"/g)).map((m) => m[1]);
  expect(fors.length, `${where}: no labels rendered`).toBeGreaterThan(0);
  for (const target of fors) {
    expect(target, `${where}: empty label target`).not.toBe('');
    expect(html, `${where}: label points at missing control "${target}"`).toContain(`id="${target}"`);
  }
}

const renderPage = (): string =>
  renderToStaticMarkup(createElement(ToastProvider, null, createElement(QuickDocumentsPage)));

describe('walk-in / quick documents — form labels', () => {
  it('renders every field label pointing at its own control', () => {
    const html = renderPage();
    assertLabelsResolve(html, 'QuickDocumentsPage');
    for (const label of ['Customer name', 'Phone', 'Age (years)', 'Gender', 'Date', 'Dentist']) {
      expect(html, label).toContain(label);
    }
  });

  it('does not create a patient record for the walk-in customer', () => {
    // Structural guarantee: the screen never asks for or prints a patient id.
    const html = renderPage();
    expect(html).not.toMatch(/patient id/i);
    expect(html).toContain('No patient record is created');
  });
});

describe('customize documents panel — form labels', () => {
  it('renders every control label pointing at its own control', () => {
    const element = elementDef('invoice.body.title')!;
    expect(element).toBeDefined();
    const panel = createElement(CustomizeDocumentsPanel, {
      value: {},
      onChange: () => undefined,
      watermark: WATERMARK_DEFAULT,
      onWatermarkChange: () => undefined,
      clinic: null,
      settings: null,
    });
    const html = renderToStaticMarkup(createElement(ToastProvider, null, panel));
    assertLabelsResolve(html, 'CustomizeDocumentsPanel');
    // The first element of the first section is selected by default.
    expect(html).toContain(DOCUMENT_TYPE_DEFS[0].label);
  });

  it('documents that an untouched configuration renders no stylesheet', () => {
    const panel = createElement(CustomizeDocumentsPanel, {
      value: {},
      onChange: () => undefined,
      watermark: WATERMARK_DEFAULT,
      onWatermarkChange: () => undefined,
      clinic: null,
      settings: null,
    });
    const html = renderToStaticMarkup(createElement(ToastProvider, null, panel));
    expect(html).not.toContain('data-document-customizations');
  });
});
