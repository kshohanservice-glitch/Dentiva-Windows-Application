import React from 'react';
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

/**
 * Screen frame around a real printable document. The inner `.print-doc` is the
 * same element the print window renders, so spacing, fonts, tables and page
 * geometry are what will be printed; the frame only adds screen chrome.
 */
export function DocumentPreview(props: {
  children: React.ReactNode;
  styles?: DocumentStyleMap | null;
  /** Chromium CSS zoom keeps the preview readable in a panel without changing layout. */
  zoom?: number;
  className?: string;
}): React.ReactElement {
  return (
    <div className={`doc-preview-frame ${props.className ?? ''}`.trim()}>
      <DocumentStyleSheet styles={props.styles} />
      <div className="print-doc doc-preview" style={props.zoom && props.zoom !== 1 ? { zoom: props.zoom } : undefined}>
        {props.children}
      </div>
    </div>
  );
}
