import { describe, expect, it } from 'vitest';
import { formatBdt } from '../../src/shared/currency';
import { splitFormattedMoney } from '../../src/shared/formatted-money';

describe('formatted report money segmentation', () => {
  it('extracts signed and grouped money from mixed report totals without floats', () => {
    expect(splitFormattedMoney('Cash: ৳1,234.56 · Refund: -৳7.00')).toEqual([
      { text: 'Cash: ' }, { paisa: 123456 }, { text: ' · Refund: ' }, { paisa: -700 },
    ]);
  });
  it('keeps patient IDs, counts, plain numbers and text unchanged', () => {
    expect(splitFormattedMoney('P-1234, age 45')).toEqual([{ text: 'P-1234, age 45' }]);
    expect(splitFormattedMoney(42)).toEqual([{ text: '42' }]);
    expect(splitFormattedMoney(null)).toEqual([{ text: '' }]);
  });
  it('matches all valid report formatter amounts and rejects unsafe numeric values', () => {
    for (const value of [0, -120, 123456, 999999999999]) {
      expect(splitFormattedMoney(formatBdt(value))).toEqual([{ paisa: value }]);
    }
    expect(splitFormattedMoney('৳9999999999999999999.99')).toEqual([{ text: '৳9999999999999999999.99' }]);
  });
});
