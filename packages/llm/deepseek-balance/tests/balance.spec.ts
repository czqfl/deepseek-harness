// DeepSeek balance Remote: provider wire parsing and explicit failure modes.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import DeepSeekBalanceService, {
  type DeepSeekBalanceConnection,
  type DeepSeekBalanceResult,
} from '../src/index.ts'

const CONNECTION: DeepSeekBalanceConnection = { baseURL: 'https://api.deepseek.com', apiKey: 'sk-test' }

function wire(isAvailable = true, info?: unknown): string {
  return JSON.stringify({
    is_available: isAvailable,
    balance_infos: info === undefined
      ? [{ currency: 'CNY', total_balance: '12.34', granted_balance: '2.00', topped_up_balance: '10.34' }]
      : info,
  })
}

async function service(resolveConnection: () => Promise<DeepSeekBalanceConnection>): Promise<DeepSeekBalanceService> {
  const ctx = new Context()
  return new DeepSeekBalanceService(ctx, { resolveConnection })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function okResult(result: DeepSeekBalanceResult): { ok: true } & Extract<DeepSeekBalanceResult, { ok: true }> {
  if (!result.ok) throw new Error(`expected ok balance, got ${result.code}`)
  return result
}

describe('DeepSeekBalanceService', () => {
  it('queries {baseURL}/user/balance with the Bearer key and parses the CNY row', async () => {
    const fetchMock = vi.fn(async () => new Response(wire(), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const instance = await service(async () => CONNECTION)
    const result = okResult(await instance.remoteExportQuery())
    expect(fetchMock).toHaveBeenCalledWith('https://api.deepseek.com/user/balance', expect.objectContaining({
      headers: { authorization: 'Bearer sk-test' },
    }))
    expect(result).toEqual({
      ok: true,
      isAvailable: true,
      currency: 'CNY',
      totalBalance: 12.34,
      grantedBalance: 2,
      toppedUpBalance: 10.34,
    })
  })

  it('falls back to the first balance_info when no CNY row exists', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(wire(true, [
      { currency: 'USD', total_balance: 5 },
    ]), { status: 200 })))
    const instance = await service(async () => CONNECTION)
    const result = okResult(await instance.remoteExportQuery())
    expect(result.currency).toBe('USD')
    expect(result.totalBalance).toBe(5)
  })

  it('reports account unavailability from the wire flag', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(wire(false), { status: 200 })))
    const instance = await service(async () => CONNECTION)
    expect(okResult(await instance.remoteExportQuery()).isAvailable).toBe(false)
  })

  it('returns missing-credential when the connection resolver rejects', async () => {
    const instance = await service(async () => {
      throw new Error('llm-deepseek: no API key for provider route "deepseek-official"')
    })
    const result = await instance.remoteExportQuery()
    expect(result).toMatchObject({ ok: false, code: 'missing-credential' })
  })

  it('returns fetch-failed on a non-ok HTTP response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })))
    const instance = await service(async () => CONNECTION)
    expect(await instance.remoteExportQuery()).toMatchObject({ ok: false, code: 'fetch-failed', message: 'HTTP 401' })
  })

  it('returns fetch-failed when the payload carries no balance rows', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(wire(true, []), { status: 200 })))
    const instance = await service(async () => CONNECTION)
    expect(await instance.remoteExportQuery()).toMatchObject({ ok: false, code: 'fetch-failed' })
  })

  it('returns fetch-failed when the provider call throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('socket hang up') }))
    const instance = await service(async () => CONNECTION)
    expect(await instance.remoteExportQuery()).toMatchObject({ ok: false, code: 'fetch-failed', message: 'socket hang up' })
  })
})
