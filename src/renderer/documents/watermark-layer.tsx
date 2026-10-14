import React from 'react';
import {
  WATERMARK_SCOPE_NOTE, watermarkAppliesTo, watermarkBoxMm, watermarkEnabled,
  type WatermarkSettings,
} from '../../shared/watermark';

/**
 * Clinic-logo watermark layer for printable documents.
 *
 * Rendered by the print window (`PrintPage`) and by the in-app document preview
 * (`DocumentPreview`), so the preview and the printed page cannot disagree.
 * It is a page-level element, not part of any document body, which is why a
 * document's own markup stays exactly as the clinic customized it.
 *
 * Guarantees:
 *   - nothing is rendered while the watermark is disabled or no clinic logo is
 *     configured (the default state, and the state of every existing install);
 *   - the box is sized from real page millimetres, so the mark is centred on the
 *     paper for A4/A5/custom and for portrait or landscape;
 *   - the logo is fitted inside that box (`object-fit: contain`), so a very wide
 *     or very tall logo is scaled — never stretched, never clipped;
 *   - only the logo is transparent, never the document;
 *   - the layer is painted underneath the document content
 *     (`.print-watermark-layer` in `styles/print.css`).
 */
export function WatermarkLayer(props: {
  settings?: WatermarkSettings | null;
  logoDataUrl?: string | null;
  pageWidthMm: number;
  pageHeightMm: number;
  /** Printable document kind; the excluded kinds never receive a watermark. */
  documentKind?: string | null;
}): React.ReactElement | null {
  const { settings, logoDataUrl, pageWidthMm, pageHeightMm } = props;
  if (!watermarkEnabled(settings, logoDataUrl)) return null;
  if (props.documentKind != null && !watermarkAppliesTo(props.documentKind)) return null;

  const box = watermarkBoxMm(settings, pageWidthMm, pageHeightMm);
  return (
    <div className="print-watermark-layer" aria-hidden="true" data-watermark="clinic-logo">
      <div
        className="print-watermark-box"
        data-watermark-box="1"
        style={{
          width: `${box.widthMm}mm`,
          height: `${box.heightMm}mm`,
          opacity: settings!.opacity,
        }}
      >
        <img className="print-watermark-logo" src={logoDataUrl as string} alt="" />
      </div>
    </div>
  );
}

export { WATERMARK_SCOPE_NOTE };
