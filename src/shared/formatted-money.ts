import { isDisplayablePaisa } from './money-mask';

/**
 * Legacy reports include formatted BDT in text cells (and mixed totals such as
 * "cash: ৳100.00 · card: ৳20.00"). Split only values emitted by formatBdt;
 * keep non-financial numbers, IDs and text unchanged. Never convert via floats.
 */
export type MoneyTextPart = { text: string } | { paisa: number };
// Also handle older audit summaries containing "123.45 BDT" instead of the symbol.
const BDT_TOKEN = /(?:-?৳(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}|-?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2} BDT)/g;

export function splitFormattedMoney(value: string | number | null | undefined): MoneyTextPart[] {
  const input = String(value ?? '');
  const result: MoneyTextPart[] = [];
  let last = 0;
  for (const match of input.matchAll(BDT_TOKEN)) {
    const index = match.index;
    const token = match[0];
    const negative = token.startsWith('-');
    const digits = token.replace(/[-৳,]/g, '').replace(/ BDT$/, '');
    const [taka, fraction] = digits.split('.');
    const paisa = (Number(taka) * 100 + Number(fraction)) * (negative ? -1 : 1);
    if (!isDisplayablePaisa(paisa)) continue;
    if (index > last) result.push({ text: input.slice(last, index) });
    result.push({ paisa });
    last = index + token.length;
  }
  if (last < input.length || result.length === 0) result.push({ text: input.slice(last) });
  return result;
}
