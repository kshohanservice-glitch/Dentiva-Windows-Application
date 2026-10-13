import { describe, expect, it } from 'vitest';
import { hasInvoiceDraftChanges, hasPaymentDraftChanges } from '../../src/shared/unsaved';

describe('financial draft close protection', () => {
  it('does not prompt for the prefilled due or blank invoice line', () => {
    expect(hasPaymentDraftChanges({ amountPaisa: 50000, method: '', reference: '', note: '' }, 50000)).toBe(false);
    const invoice = {
      date: '2026-10-13', note: '', discountPaisa: 0,
      items: [{ description: '', qty: 1, unitPricePaisa: 0, treatmentId: null }],
    };
    expect(hasInvoiceDraftChanges(invoice, invoice.date, false, '')).toBe(false);
    expect(hasInvoiceDraftChanges(invoice, invoice.date, true, '')).toBe(true);
    expect(hasInvoiceDraftChanges(invoice, invoice.date, false, 'Karim')).toBe(true);
    expect(hasInvoiceDraftChanges({ ...invoice, items: [{ ...invoice.items[0], unitPricePaisa: 100 }] }, invoice.date, false, '')).toBe(true);
    expect(hasInvoiceDraftChanges({ ...invoice, items: [] }, invoice.date, false, '')).toBe(true);
  });
  it('protects entered payment method, reference, note and edited amount', () => {
    const initial = { amountPaisa: 50000, method: '', reference: '', note: '' };
    expect(hasPaymentDraftChanges({ ...initial, amountPaisa: 25000 }, 50000)).toBe(true);
    expect(hasPaymentDraftChanges({ ...initial, method: 'cash' }, 50000)).toBe(true);
    expect(hasPaymentDraftChanges({ ...initial, reference: 'TRX' }, 50000)).toBe(true);
    expect(hasPaymentDraftChanges({ ...initial, note: 'A note' }, 50000)).toBe(true);
  });
});
