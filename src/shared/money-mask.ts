/**
 * Pure rules for masking money amounts in the UI.
 *
 * Amounts are integer paisa end to end; this module never performs float math.
 * A masked amount is always the fixed placeholder, never a length-revealing value.
 */
export const MONEY_MASK = '****';
export const MONEY_EMPTY = '—';

/** True only for integer paisa values that are safe to format. */
export function isDisplayablePaisa(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

/**
 * What a money cell shows. `format` is the real formatter (BDT), injected so this
 * module stays dependency-free and testable.
 */
export function maskedAmount(paisa: number | null | undefined, revealed: boolean, format: (p: number) => string): string {
  if (!isDisplayablePaisa(paisa)) return MONEY_EMPTY;
  return revealed ? format(paisa) : MONEY_MASK;
}
