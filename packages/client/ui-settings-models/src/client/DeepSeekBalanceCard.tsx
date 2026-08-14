/**
 * Official-DeepSeek account balance card for the Models page. One button
 * queries the Host's balance Remote and shows the CNY total (and an
 * availability warning when the provider reports the account as unavailable).
 * The query result is plain component state; the injected callback owns the
 * transport.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { DeepSeekBalanceResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { en } from './locales.ts'
import styles from './DeepSeekBalanceCard.module.css'

/** Balance card copy seat, bound to the Models dictionary. */
export type BalanceCardT = (key: keyof typeof en) => string

/** Props: the balance query verb plus the feature copy. */
export interface DeepSeekBalanceCardProps {
  /** Query the official DeepSeek account balance (unwraps the wire result). */
  queryBalance: () => Promise<DeepSeekBalanceResult>
  /** Models-page copy. */
  t: BalanceCardT
}

type BalanceState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'done'; readonly result: DeepSeekBalanceResult }

/** Compact CNY amount with two decimals (the provider reports yuan amounts). */
export function formatBalanceCNY(cny: number): string {
  return Number.isFinite(cny) ? `¥${cny.toFixed(2)}` : '—'
}

/**
 * Render the DeepSeek balance card.
 * @param props - query verb and copy.
 * @returns the card.
 */
export function DeepSeekBalanceCard({ queryBalance, t }: DeepSeekBalanceCardProps): ReactNode {
  const [state, setState] = useState<BalanceState>({ kind: 'idle' })
  const query = (): void => {
    // v8 ignore next 2 -- the disabled button already blocks re-entry; this arm guards direct invocation
    if (state.kind === 'loading') return
    setState({ kind: 'loading' })
    void queryBalance().then(result => { setState({ kind: 'done', result }) })
  }
  let outcome: ReactNode = null
  if (state.kind === 'done') {
    const result = state.result
    outcome = result.ok
      ? (
        <p className={styles['line']} data-balance-ok>
          {t('balanceTotal')}{formatBalanceCNY(result.totalBalance)}
          {!result.isAvailable ? (
            <>
              {' '}
              <span className={styles['warning']}>{t('balanceUnavailable')}</span>
            </>
          ) : null}
        </p>
      )
      : <p className={styles['error']} data-balance-error>{t('balanceFailed')}{result.message}</p>
  }
  return (
    <section className={styles['card']} data-balance-card>
      <h3 className={styles['title']}>{t('balanceTitle')}</h3>
      <div className={styles['row']}>
        <button
          type="button"
          className={styles['button']}
          disabled={state.kind === 'loading'}
          onClick={query}
        >
          {state.kind === 'loading' ? t('balanceQuerying') : t('balanceQuery')}
        </button>
        {outcome}
      </div>
    </section>
  )
}
