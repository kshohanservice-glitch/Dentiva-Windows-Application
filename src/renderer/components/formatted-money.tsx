import React from 'react';
import { splitFormattedMoney } from '../../shared/formatted-money';
import { formatBdt } from '../../shared/currency';
import { Money } from './money';

/**
 * Financial text coming from existing report/settings DTOs.
 *
 * On screen the amounts are masked exactly like everywhere else. With
 * `printable` the same text is rendered for the print/PDF export path, where the
 * authoritative amount must appear — masking is a UI-only affordance and must
 * never leak into a document (see `components/print-money.tsx`).
 */
export function FormattedMoney({ value, printable = false }: { value: string | number | null | undefined; printable?: boolean }) {
  return <>{splitFormattedMoney(value).map((part, i) => (
    'text' in part
      ? <React.Fragment key={i}>{part.text}</React.Fragment>
      : printable
        ? <span className="print-money" key={i}>{formatBdt(part.paisa)}</span>
        : <Money paisa={part.paisa} key={i} />
  ))}</>;
}
