export const TEMPLATE_KINDS = ['visit', 'plan', 'notes', 'prescription', 'instructions', 'invoice_items'] as const;
export type ClinicalTemplateKind = (typeof TEMPLATE_KINDS)[number];

export interface InvoiceTemplateItem {
  description: string;
  qty: number;
  unitPricePaisa: number;
  treatmentId: number | null;
}

export type ClinicalTemplateBody = Record<string, string> | { items: InvoiceTemplateItem[] };
export interface ClinicalTemplate {
  id: number;
  kind: ClinicalTemplateKind;
  name: string;
  body: ClinicalTemplateBody;
  updatedAt: string;
}
