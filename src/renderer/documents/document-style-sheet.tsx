import React from 'react';
import { documentStyleCss, type DocumentStyleMap } from '../../shared/document-styles';

/**
 * Emits the generated customization stylesheet for the document that follows it.
 *
 * With no stored customizations the component renders **nothing** — not an empty
 * `<style>` tag — so an untouched document keeps exactly the markup and styling
 * it had before the customization feature existed. Every rule is scoped to
 * `.print-doc [data-doc-el="…"]`, so a customization can only ever affect the
 * tagged element inside a printable document, never ordinary application
 * screens.
 */
export function DocumentStyleSheet({ styles }: { styles?: DocumentStyleMap | null }): React.ReactElement | null {
  const css = documentStyleCss(styles);
  if (!css) return null;
  return <style data-document-customizations="">{css}</style>;
}
