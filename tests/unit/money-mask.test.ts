import { describe, expect, it } from 'vitest';
import { isDisplayablePaisa, maskedAmount, MONEY_EMPTY, MONEY_MASK } from '../../src/shared/money-mask';
import { bdt } from '../../src/renderer/format';

describe('money masking rules', () => {
  it('hides every amount behind the fixed mask until revealed', () => {
    expect(maskedAmount(150000, false, bdt)).toBe(MONEY_MASK);
    expect(maskedAmount(0, false, bdt)).toBe(MONEY_MASK);
    expect(maskedAmount(-2500, false, bdt)).toBe(MONEY_MASK);
  });

  it('formats integer paisa exactly when revealed (no float drift)', () => {
    expect(maskedAmount(150000, true, bdt)).toBe('৳1,500.00');
    expect(maskedAmount(1, true, bdt)).toBe('৳0.01');
    expect(maskedAmount(99999999999, true, bdt)).toBe('৳999,999,999.99');
  });

  it('shows an empty placeholder for missing or non-integer values, never a masked number', () => {
    expect(maskedAmount(null, false, bdt)).toBe(MONEY_EMPTY);
    expect(maskedAmount(undefined, true, bdt)).toBe(MONEY_EMPTY);
    expect(maskedAmount(12.5, true, bdt)).toBe(MONEY_EMPTY);
    expect(maskedAmount(Number.NaN, true, bdt)).toBe(MONEY_EMPTY);
    expect(maskedAmount(Number.MAX_SAFE_INTEGER + 2, true, bdt)).toBe(MONEY_EMPTY);
  });

  it('validates displayable paisa strictly', () => {
    expect(isDisplayablePaisa(100)).toBe(true);
    expect(isDisplayablePaisa('100')).toBe(false);
    expect(isDisplayablePaisa(1.5)).toBe(false);
  });
});
