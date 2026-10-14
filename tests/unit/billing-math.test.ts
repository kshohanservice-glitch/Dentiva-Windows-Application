/**
 * Shared invoice arithmetic.
 *
 * Extracted from the billing service so the walk-in / quick-invoice path cannot
 * drift from the stored path. These tests pin the exact semantics the service
 * stores in the database:
 *   - `subtotal` is the un-discounted sum of qty × unit,
 *   - the invoice row's `discount` is `subtotal − total`,
 *   - nothing can produce a negative total,
 *   - paid/due and the invoice status follow the same rules everywhere.
 */
import { describe, expect, it } from 'vitest';
import {
  computeInvoiceStatus, computeInvoiceTotals, lineTotalPaisa, paymentSummary, toPaisa,
} from '../../src/shared/billing-math';

describe('toPaisa', () => {
  it('coerces anything unusable to 0 paisa', () => {
    for (const value of [null, undefined, '', 'abc', NaN, Infinity, -5, {}]) {
      expect(toPaisa(value)).toBe(0);
    }
  });

  it('rounds to whole paisa', () => {
    expect(toPaisa(1234.6)).toBe(1235);
    expect(toPaisa('2500')).toBe(2500);
  });
});

describe('lineTotalPaisa', () => {
  it('is qty × unit − discount', () => {
    expect(lineTotalPaisa(3, 25000)).toBe(75000);
    expect(lineTotalPaisa(3, 25000, 5000)).toBe(70000);
  });

  it('never goes below zero', () => {
    expect(lineTotalPaisa(1, 1000, 5000)).toBe(0);
  });
});

describe('computeInvoiceTotals', () => {
  it('sums lines exactly, in integer paisa', () => {
    const totals = computeInvoiceTotals([
      { description: 'Consultation', qty: 1, unitPricePaisa: 80000 },
      { description: 'X-ray', qty: 2, unitPricePaisa: 100000 },
      { description: 'Extraction', qty: 1, unitPricePaisa: 250050, discountPaisa: 50050 },
    ]);
    expect(totals.subtotalPaisa).toBe(80000 + 200000 + 250050);
    expect(totals.lineDiscountPaisa).toBe(50050);
    expect(totals.lines[2].totalPaisa).toBe(200000);
    expect(totals.totalPaisa).toBe(480000);
  });

  it('subtracts the invoice discount after the line discounts', () => {
    const totals = computeInvoiceTotals(
      [{ description: 'Cleaning', qty: 1, unitPricePaisa: 300000, discountPaisa: 50000 }],
      100000,
    );
    expect(totals.subtotalPaisa).toBe(300000);
    expect(totals.lineDiscountPaisa).toBe(50000);
    expect(totals.invoiceDiscountPaisa).toBe(100000);
    expect(totals.totalPaisa).toBe(150000);
  });

  it('matches the amount the invoice row stores as its discount', () => {
    const totals = computeInvoiceTotals(
      [{ description: 'Braces', qty: 1, unitPricePaisa: 5000000 }],
      250000,
    );
    // `billing.ts` stores `subtotal - total` in `discount_paisa`.
    expect(totals.subtotalPaisa - totals.totalPaisa).toBe(250000);
  });

  it('clamps a total at zero when the discount exceeds the invoice', () => {
    const totals = computeInvoiceTotals([{ description: 'Visit', qty: 1, unitPricePaisa: 50000 }], 90000);
    expect(totals.totalPaisa).toBe(0);
    expect(totals.subtotalPaisa - totals.totalPaisa).toBe(50000);
  });

  it('never rounds: repeated hundredth-paisa values stay integers', () => {
    const lines = Array.from({ length: 3 }, () => ({ description: 'Item', qty: 3, unitPricePaisa: 33333 }));
    const totals = computeInvoiceTotals(lines, 1);
    expect(Number.isInteger(totals.totalPaisa)).toBe(true);
    expect(totals.totalPaisa).toBe(3 * 3 * 33333 - 1);
  });

  it('treats missing input as an empty invoice', () => {
    expect(computeInvoiceTotals(undefined).totalPaisa).toBe(0);
    expect(computeInvoiceTotals(null, 5000).totalPaisa).toBe(0);
    expect(computeInvoiceTotals([]).lines).toEqual([]);
  });
});

describe('paymentSummary', () => {
  it('splits total, paid, due and overpayment', () => {
    expect(paymentSummary(100000, 40000)).toEqual({ paidPaisa: 40000, duePaisa: 60000, overpaidPaisa: 0 });
    expect(paymentSummary(100000, 100000)).toEqual({ paidPaisa: 100000, duePaisa: 0, overpaidPaisa: 0 });
    // An overpayment is reported, never silently swallowed or applied twice.
    expect(paymentSummary(100000, 150000)).toEqual({ paidPaisa: 100000, duePaisa: 0, overpaidPaisa: 50000 });
  });

  it('never reports a negative due', () => {
    expect(paymentSummary(0, 0).duePaisa).toBe(0);
  });
});

describe('computeInvoiceStatus', () => {
  it('follows the stored-invoice rules', () => {
    expect(computeInvoiceStatus(100000, 0)).toBe('unpaid');
    expect(computeInvoiceStatus(100000, 1)).toBe('partial');
    expect(computeInvoiceStatus(100000, 100000)).toBe('paid');
    expect(computeInvoiceStatus(100000, 99999)).toBe('partial');
    // A fully discounted invoice is settled by definition.
    expect(computeInvoiceStatus(0, 0)).toBe('paid');
  });

  it('leaves a voided invoice voided whatever was paid', () => {
    expect(computeInvoiceStatus(100000, 100000, true)).toBe('voided');
  });
});
