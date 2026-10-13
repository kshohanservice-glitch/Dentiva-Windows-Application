export const TEMPLATE_KINDS = ['visit', 'plan', 'notes', 'prescription', 'instructions', 'invoice_items'] as const;
export type ClinicalTemplateKind = (typeof TEMPLATE_KINDS)[number];

export interface InvoiceTemplateItem {
  description: string;
  qty: number;
  unitPricePaisa: number;
  treatmentId: number | null;
}

export type ClinicalTemplateBody = Record<string, string> | { items: InvoiceTemplateItem[] };
/** Applying a template over entered values must ask before replacing the draft. */
export function hasTemplateDraftContent(body: ClinicalTemplateBody): boolean {
  if (Array.isArray(body.items)) {
    return body.items.some((item) => !!item.description.trim() || item.qty !== 1 || item.unitPricePaisa !== 0 || item.treatmentId != null);
  }
  return Object.values(body).some((value) => typeof value === 'string' && !!value.trim());
}

export interface ClinicalTemplate {
  id: number;
  kind: ClinicalTemplateKind;
  name: string;
  body: ClinicalTemplateBody;
  updatedAt: string;
}
