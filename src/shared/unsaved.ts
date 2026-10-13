// Pure change detection for the two financial forms. Passing the initial due/date
// explicitly avoids treating their prefilled values as user edits.
export function hasPaymentDraftChanges(
  values: { amountPaisa: number; method: string; reference: string; note: string },
  initialDuePaisa: number,
): boolean {
  return values.amountPaisa !== initialDuePaisa || !!values.method || !!values.reference || !!values.note;
}

export function hasInvoiceDraftChanges(
  values: {
    date: string; note: string; discountPaisa: number;
    items: { description: string; qty: number; unitPricePaisa: number; treatmentId: number | null }[];
  },
  initialDate: string,
  patientSelectedInForm: boolean,
  patientQuery: string,
): boolean {
  return values.date !== initialDate || !!values.note || values.discountPaisa !== 0 ||
    values.items.length !== 1 || values.items[0].description !== '' || values.items[0].qty !== 1 ||
    values.items[0].unitPricePaisa !== 0 || values.items[0].treatmentId !== null ||
    patientSelectedInForm || !!patientQuery;
}
