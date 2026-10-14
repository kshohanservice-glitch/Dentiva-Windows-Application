import React from 'react';
import type { DocumentPageSize, DocumentWatermarkSettings } from '../../shared/document-watermark';
import {
  DEFAULT_DOCUMENT_WATERMARK, normalizeDocumentWatermark, pageSizeFromProfile,
  supportsLogoWatermark, watermarkImageBounds,
} from '../../shared/document-watermark';
import type { ClinicSettings } from '../../shared/types';
import type { CustomizableDocumentType, DocumentStyleMap } from '../../shared/document-styles';
import { DOCUMENT_SAMPLES } from './samples';
import { DocumentStyleSheet } from './document-style-sheet';
import {
  appointmentCardDoc, invoiceDoc, prescriptionDoc, receiptDoc, reportDoc, stockLabelDoc, visitSummaryDoc,
} from './print-documents';

/**
 * A realistic example of a document type, rendered by the **real** document
 * builders (the same functions the print window uses) with the sample payload
 * from `shared/document-samples.ts`.
 *
 * A preview that looks right while the printout differs is useless, so there is
 * deliberately no separate preview renderer.
 */
export function sampleDocumentNode(
  docType: CustomizableDocumentType,
  override?: { clinic?: any; settings?: any; dentist?: any },
): React.ReactNode {
  const data = DOCUMENT_SAMPLES[docType]();
  const merged = {
    ...data,
    ...(override?.clinic ? { clinic: override.clinic } : {}),
    ...(override?.settings ? { settings: override.settings } : {}),
    ...(override?.dentist ? { dentist: override.dentist } : {}),
  };
  switch (docType) {
    case 'prescription':
      return prescriptionDoc(merged);
    case 'invoice':
      return invoiceDoc(merged);
    case 'receipt':
      return receiptDoc(merged);
    case 'visit-summary':
      return visitSummaryDoc(merged);
    case 'appointment-card':
      return appointmentCardDoc(merged);
    case 'stock-labels':
      return stockLabelDoc(merged);
    case 'report':
      return reportDoc(merged);
  }
}

/** The logo stays within physical page bounds and retains its source aspect ratio. */
export function ClinicLogoWatermark(props: {
  clinic?: Pick<ClinicSettings, 'logoDataUrl'> | null;
  settings?: DocumentWatermarkSettings | null;
  documentType?: string | null;
  pageSize?: DocumentPageSize | null;
}): React.ReactElement | null {
  const watermark = normalizeDocumentWatermark(props.settings ?? DEFAULT_DOCUMENT_WATERMARK);
  const logoDataUrl = props.clinic?.logoDataUrl;
  if (!watermark.enabled || !logoDataUrl || !supportsLogoWatermark(props.documentType)) return null;

  const pageSize = props.pageSize ?? pageSizeFromProfile();
  const bounds = watermarkImageBounds(pageSize, watermark.sizePercent);
  const imageStyle = {
    '--watermark-opacity': watermark.opacity,
    '--watermark-max-width': `${bounds.maxWidthMm}mm`,
    '--watermark-max-height': `${bounds.maxHeightMm}mm`,
  } as React.CSSProperties;

  return (
    <div className="print-logo-watermark" aria-hidden="true" style={imageStyle}>
      <img src={logoDataUrl} alt="" draggable={false} />
    </div>
  );
}

/**
 * Screen frame around a real printable document. The inner `.print-doc` is the
 * same element the print window renders, so spacing, fonts, tables and page
 * geometry are what will be printed; the frame only adds screen chrome.
 */
export function DocumentPreview(props: {
  children: React.ReactNode;
  styles?: DocumentStyleMap | null;
  watermark?: DocumentWatermarkSettings | null;
  /** Only the logo is needed: the preview never reads other clinic fields. */
  clinic?: Pick<ClinicSettings, 'logoDataUrl'> | null;
  documentType?: string | null;
  pageSize?: DocumentPageSize | null;
  /** Chromium CSS zoom keeps the preview readable in a panel without changing layout. */
  zoom?: number;
  className?: string;
}): React.ReactElement {
  const pageSize = props.pageSize ?? pageSizeFromProfile();
  return (
    <div className={`doc-preview-frame ${props.className ?? ''}`.trim()}>
      <DocumentStyleSheet styles={props.styles} />
      <div
        className="print-doc doc-preview"
        style={{
          width: `${pageSize.widthMm}mm`,
          minHeight: `${pageSize.heightMm}mm`,
          zoom: props.zoom && props.zoom !== 1 ? props.zoom : undefined,
        }}
      >
        <ClinicLogoWatermark
          clinic={props.clinic}
          settings={props.watermark}
          documentType={props.documentType}
          pageSize={pageSize}
        />
        {/* Content layer: paints above the logo watermark (see print.css). */}
        <div className="print-doc-content">{props.children}</div>
      </div>
    </div>
  );
}
