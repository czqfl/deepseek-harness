// @vitest-environment jsdom
// DeepSeek balance card: query states render the CNY total, the availability
// warning, or the explicit failure.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { DeepSeekBalanceResult } from '@deepseek-ai/dsh-api-remotes/client'
import { en } from '../src/client/locales.ts'
import {
  DeepSeekBalanceCard, formatBalanceCNY,
  type DeepSeekBalanceCardProps,
} from '../src/client/DeepSeekBalanceCard.tsx'

const t: DeepSeekBalanceCardProps['t'] = (key: keyof typeof en) => en[key]

const ok: DeepSeekBalanceResult = {
  ok: true,
  isAvailable: true,
  currency: 'CNY',
  totalBalance: 12.34,
  grantedBalance: 2,
  toppedUpBalance: 10.34,
}

function props(queryBalance: () => Promise<DeepSeekBalanceResult>): DeepSeekBalanceCardProps {
  return { queryBalance, t }
}

describe('DeepSeekBalanceCard', () => {
  afterEach(() => { cleanup() })

  it('renders the CNY total after a successful query', async () => {
    const view = render(<DeepSeekBalanceCard {...props(async () => ok)} />)
    expect(view.container.querySelector('[data-balance-card]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button'))
    expect(await screen.findByText('Total balance ¥12.34')).not.toBeNull()
  })

  it('flags an unavailable account beside the total', async () => {
    render(<DeepSeekBalanceCard {...props(async () => ({ ...ok, isAvailable: false }))} />)
    fireEvent.click(screen.getByRole('button'))
    expect(await screen.findByText('(account unavailable)')).not.toBeNull()
  })

  it('renders the failure message and keeps the button re-clickable', async () => {
    const failing = async (): Promise<DeepSeekBalanceResult> => ({ ok: false, code: 'fetch-failed', message: 'HTTP 401' })
    const view = render(<DeepSeekBalanceCard {...props(failing)} />)
    fireEvent.click(screen.getByRole('button'))
    expect(await screen.findByText('Balance query failed: HTTP 401')).not.toBeNull()
    expect(view.container.querySelector('[data-balance-error]')).not.toBeNull()
  })

  it('ignores clicks while a query is in flight', async () => {
    let settle: (result: DeepSeekBalanceResult) => void = () => {}
    const pending = vi.fn<() => Promise<DeepSeekBalanceResult>>()
    pending.mockImplementation(() => new Promise<DeepSeekBalanceResult>(resolve => { settle = resolve }))
    render(<DeepSeekBalanceCard {...props(pending)} />)
    const button = screen.getByRole('button') as HTMLButtonElement
    fireEvent.click(button)
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(pending).toHaveBeenCalledTimes(1)
    settle(ok)
    expect(await screen.findByText('Total balance ¥12.34')).not.toBeNull()
  })
})

describe('formatBalanceCNY', () => {
  it('formats yuan to two decimals and blanks non-finite values', () => {
    expect(formatBalanceCNY(12.345)).toBe('¥12.35')
    expect(formatBalanceCNY(0)).toBe('¥0.00')
    expect(formatBalanceCNY(Number.NaN)).toBe('—')
  })
})
