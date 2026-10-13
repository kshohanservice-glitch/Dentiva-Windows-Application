import React from 'react';
import { splitFormattedMoney } from '../../shared/formatted-money';
import { formatBdt } from '../../shared/currency';
import { Money } from './money';

/** Financial text from existing report DTOs is masked without altering its export payload. */
export function FormattedMoney({ value, printable = false }: { value: string | number | null | undefined; printable?: boolean }) {
  return <>{splitFormattedMoney(value).map((part, i) => (
    'text' in part ? <React.Fragment key={i}>{part.text}</React.Fragment> : printable ? (
      <span className="print-money" key={i}>
        <span className="print-money-screen"><Money paisa={part.paisa} /></span>
        <span className="print-money-paper" aria-hidden="true">{formatBdt(part.paisa)}</span>
      </span>
    ) : <Money paisa={part.paisa} key={i} />
  ))}</>;
}
