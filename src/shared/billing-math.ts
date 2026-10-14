/**
 * Integer-exact invoice arithmetic.
 *
 * Single source of truth for:
 *   - stored invoices           (`src/main/services/billing.ts`)
 *   - walk-in / quick invoices  (`src/renderer/pages/QuickDocuments.tsx` and
 *     `src/renderer/documents/quick-document-view.tsx`)
 *
 * Every amount is an integer number of paisa (1 BDT = 100 paisa). No floating
 * point is used anywhere, so an equivalent invoice always totals identically in
 * both workflows and no rounded value can drift from what is stored.
 *
 * The functions are pure and total: unknown/short input yields zeros rather
 * than throwing, because they are also used to render previews of forms that
 * are still incomplete.
 */

export interface InvoiceLineInput {
  description: string;
  qty: number;
  unitPricePaisa: number;
  /** Per-line discount in paisa. */
  discountPaisa?: number;
}

export interface InvoiceLineTotals {
  description: string;
  qty: number;
  unitPricePaisa: number;
  discountPaisa: number;
  /** `qty × unit − discount`, never below zero. */
  totalPaisa: number;
}

export interface InvoiceTotals {
  lines: InvoiceLineTotals[];
  /** Σ qty × unit — before any discount. */
  subtotalPaisa: number;
  /** Σ per-line discounts. */
  lineDiscountPaisa: number;
  /** Discount applied to the whole invoice. */
  invoiceDiscountPaisa: number;
  /** `subtotal − lineDiscounts − invoiceDiscount`, never below zero. */
  totalPaisa: number;
}

const MAX_PAISA = 9_000_000_000_000;

/** Coerce to a non-negative integer paisa amount; anything unusable becomes 0. */
export function toPaisa(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const rounded = Math.round(n);
  if (rounded <= 0) return 0;
  return Math.min(rounded, MAX_PAISA);
}

/** `qty × unit − discount`, clamped at zero. */
export function lineTotalPaisa(qty: unknown, unitPricePaisa: unknown, discountPaisa: unknown = 0): number {
  const q = toPaisa(qty);
  const unit = toPaisa(unitPricePaisa);
  const disc = toPaisa(discountPaisa);
  const gross = q * unit;
  return disc >= gross ? 0 : gross - disc;
}

/**
 * Totals for an invoice, exactly as the billing service stores them:
 * `subtotal` is the un-discounted sum, and the row's `discount` is
 * `subtotal − total`.
 */
export function computeInvoiceTotals(items: InvoiceLineInput[] | null | undefined, invoiceDiscountPaisa: unknown = 0): InvoiceTotals {
  const lines: InvoiceLineTotals[] = [];
  let subtotalPaisa = 0;
  let lineDiscountPaisa = 0;
  for (const item of Array.isArray(items) ? items : []) {
    const qty = toPaisa(item?.qty ?? 0);
    const unitPricePaisa = toPaisa(item?.unitPricePaisa ?? 0);
    const gross = qty * unitPricePaisa;
    const discountPaisa = Math.min(toPaisa(item?.discountPaisa ?? 0), gross);
    subtotalPaisa += gross;
    lineDiscountPaisa += discountPaisa;
    lines.push({
      description: String(item?.description ?? ''),
      qty,
      unitPricePaisa,
      discountPaisa,
      totalPaisa: gross - discountPaisa,
    });
  }
  const invoiceDiscount = toPaisa(invoiceDiscountPaisa);
  const afterDiscounts = subtotalPaisa - lineDiscountPaisa - invoiceDiscount;
  return {
    lines,
    subtotalPaisa,
    lineDiscountPaisa,
    invoiceDiscountPaisa: invoiceDiscount,
    totalPaisa: afterDiscounts > 0 ? afterDiscounts : 0,
  };
}

export interface PaymentSummary {
  paidPaisa: number;
  duePaisa: number;
  /** Amount received beyond the total (kept visible, never hidden). */
  overpaidPaisa: number;
}

/** Paid/due split for a total and the amount received. */
export function paymentSummary(totalPaisa: unknown, paidPaisa: unknown): PaymentSummary {
  const total = toPaisa(totalPaisa);
  const paid = toPaisa(paidPaisa);
  const applied = Math.min(paid, total);
  return {
    paidPaisa: applied,
    duePaisa: total - applied,
    overpaidPaisa: paid - applied,
  };
}

export type InvoiceStatus = 'unpaid' | 'partial' | 'paid' | 'voided';

/** Status for a stored or previewed invoice — identical rules in both paths. */
export function computeInvoiceStatus(totalPaisa: unknown, paidNetPaisa: unknown, voided = false): InvoiceStatus {
  if (voided) return 'voided';
  const total = toPaisa(totalPaisa);
  const paidNet = Number(paidNetPaisa);
  if (total === 0) return 'paid';
  if (!Number.isFinite(paidNet)) return 'unpaid';
  if (paidNet >= total) return 'paid';
  if (paidNet > 0) return 'partial';
  return 'unpaid';
}
