import { formatBdt } from '../../shared/currency';
import { isDisplayablePaisa, MONEY_EMPTY } from '../../shared/money-mask';

/**
 * Authoritative money rendering for the print / PDF export path.
 *
 * UI-only amount masking (see `components/money.tsx`) keeps amounts private on
 * the working screens. A print preview, a saved PDF and a physical page are
 * deliberate, permission-gated clinic records: they must carry the real amount.
 *
 * This component therefore renders `formatBdt` directly from the integer paisa
 * value and never consults the reveal state, so it structurally cannot emit the
 * `****` mask. It is only ever used inside the print document tree
 * (`pages/PrintPage.tsx`), which itself is only reachable from an authenticated,
 * permission-checked print window.
 */
export function PrintMoney(props: { paisa: number | null | undefined; className?: string }) {
  const text = isDisplayablePaisa(props.paisa) ? formatBdt(props.paisa) : MONEY_EMPTY;
  return <span className={`print-money ${props.className ?? ''}`.trim()}>{text}</span>;
}
