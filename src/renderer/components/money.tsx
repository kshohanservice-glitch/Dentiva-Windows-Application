import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { bdt } from '../format';
import { useApp } from '../state/app-context';
import { isDisplayablePaisa, maskedAmount, MONEY_MASK } from '../../shared/money-mask';

/**
 * Money display with masking.
 *
 * - Every amount is hidden as `****` by default.
 * - A per-amount eye button reveals one amount.
 * - A global toggle (header) reveals every amount at once.
 * - Reveal state lives in memory only: it is never written to storage, and it is
 *   cleared when the app locks, the user logs out, or the account changes.
 */

interface MoneyRevealValue {
  globalRevealed: boolean;
  toggleGlobal: () => void;
}

const MoneyRevealContext = createContext<MoneyRevealValue>({ globalRevealed: false, toggleGlobal: () => undefined });

export function MoneyRevealProvider({ children }: { children: React.ReactNode }) {
  const { locked, user } = useApp();
  const [globalOn, setGlobalOn] = useState(false);
  const sessionId = user ? user.userId : null;

  // Reveal never survives a lock, a logout, or a switch to another account.
  useEffect(() => { setGlobalOn(false); }, [locked, sessionId]);

  const globalRevealed = globalOn && !locked && sessionId !== null;
  const toggleGlobal = useCallback(() => setGlobalOn((v) => !v), []);
  const value = useMemo(() => ({ globalRevealed, toggleGlobal }), [globalRevealed, toggleGlobal]);
  return <MoneyRevealContext.Provider value={value}>{children}</MoneyRevealContext.Provider>;
}

export function useMoneyReveal(): MoneyRevealValue {
  return useContext(MoneyRevealContext);
}

const EYE = (
  <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} aria-hidden="true" focusable="false">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

/** A single money amount. Renders integer paisa as BDT, or `****` while hidden. */
/**
 * `noToggle` is for amounts inside an interactive control (a button cannot hold another button).
 * Such amounts follow only the global reveal.
 */
export function Money(props: { paisa: number | null | undefined; className?: string; noToggle?: boolean }) {
  const { locked, user } = useApp();
  const { globalRevealed } = useMoneyReveal();
  const [local, setLocal] = useState(false);
  const sessionId = user ? user.userId : null;

  useEffect(() => { setLocal(false); }, [locked, sessionId]);

  // The lock overlay leaves underlying routes mounted: never reveal even for one render while locked.
  const revealed = !locked && sessionId !== null && (globalRevealed || local);
  const text = maskedAmount(props.paisa, revealed, bdt);
  const hasValue = isDisplayablePaisa(props.paisa);
  return (
    <span className={`money ${props.className ?? ''}`.trim()} data-masked={!revealed && hasValue ? 'true' : undefined}>
      <span className="money-value num" aria-label={revealed || !hasValue ? undefined : 'Amount hidden'}>{text}</span>
      {hasValue && !props.noToggle && (
        <button
          type="button"
          className="money-eye"
          aria-pressed={local}
          aria-label={local ? 'Hide this amount' : 'Show this amount'}
          title={globalRevealed ? 'All amounts are shown' : local ? 'Hide this amount' : 'Show this amount'}
          disabled={globalRevealed}
          onClick={(e) => { e.stopPropagation(); setLocal((v) => !v); }}
        >
          {EYE}
        </button>
      )}
    </span>
  );
}

/** Header control: reveal or hide every amount on screen. */
export function MoneyRevealToggle() {
  const { globalRevealed, toggleGlobal } = useMoneyReveal();
  return (
    <button
      type="button"
      className={`money-global ${globalRevealed ? 'on' : ''}`}
      aria-pressed={globalRevealed}
      onClick={toggleGlobal}
      title={globalRevealed ? 'Hide all amounts' : 'Show all amounts'}
    >
      {EYE}
      <span className="small strong">{globalRevealed ? 'Hide amounts' : `Show amounts ${MONEY_MASK}`}</span>
    </button>
  );
}
