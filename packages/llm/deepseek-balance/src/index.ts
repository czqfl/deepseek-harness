/**
 * Official-DeepSeek account balance query, served to the browser as a Remote
 * namespace. The connection facts (endpoint + credential) are resolved by the
 * mounting site (the DeepSeek chat adapter) per query, so the page always
 * reflects the configured account; the key travels only as the provider's
 * Authorization header. This package stays dependency-light so the client
 * assembly never loads host-side sources.
 * @module @deepseek-ai/dsh-deepseek-balance
 */

import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Context } from '@deepseek-ai/cordis'

/** One CNY balance report for the official DeepSeek account. */
export type DeepSeekBalanceResult =
  | {
      readonly ok: true
      /** Account availability reported by the provider. */
      readonly isAvailable: boolean
      /** Billing currency reported by the provider (normally CNY). */
      readonly currency: string
      /** Total balance in the reported currency. */
      readonly totalBalance: number
      /** Granted (promo) balance. */
      readonly grantedBalance: number
      /** Topped-up (paid) balance. */
      readonly toppedUpBalance: number
    }
  | {
      readonly ok: false
      /** `missing-credential`: no usable API key resolved; `fetch-failed`: provider/network error. */
      readonly code: 'missing-credential' | 'fetch-failed'
      readonly message: string
    }

/** Connection facts the balance query needs, resolved at call time. */
export interface DeepSeekBalanceConnection {
  readonly baseURL: string
  readonly apiKey: string
}

/** Wire response of `GET {baseURL}/user/balance`. */
interface WireBalanceResponse {
  is_available?: boolean
  balance_infos?: Array<{
    currency?: string
    total_balance?: string | number
    granted_balance?: string | number
    topped_up_balance?: string | number
  }>
}

const BALANCE_PATH = '/user/balance'
/** Provider calls must not hang the Models page; bound the request. */
const BALANCE_TIMEOUT_MS = 10_000

/** Parse a wire amount: a number or a numeric string; absent values count 0. */
function wireAmount(value: string | number | undefined): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Query the official DeepSeek account balance.
 * @param ctx - host context; the service registers itself as `deepSeekBalance`.
 * @param config - connection resolver closed over the adapter's live options
 * and per-request credential resolution.
 */
export class DeepSeekBalanceService extends TypertRemoteService {
  private readonly resolveConnection: () => Promise<DeepSeekBalanceConnection>

  constructor(ctx: Context, config: { resolveConnection: () => Promise<DeepSeekBalanceConnection> }) {
    super(ctx, 'deepSeekBalance')
    this.resolveConnection = config.resolveConnection
  }

  /**
   * Fetch and normalize the account balance.
   * @returns the CNY balance, or an explicit failure.
   */
  @Remote('query')
  async remoteExportQuery(): Promise<DeepSeekBalanceResult> {
    let connection: DeepSeekBalanceConnection
    try {
      connection = await this.resolveConnection()
    } catch (error) {
      return {
        ok: false,
        code: 'missing-credential',
        message: error instanceof Error ? error.message : String(error),
      }
    }
    try {
      const response = await fetch(`${connection.baseURL}${BALANCE_PATH}`, {
        headers: { authorization: `Bearer ${connection.apiKey}` },
        signal: AbortSignal.timeout(BALANCE_TIMEOUT_MS),
      })
      if (!response.ok) {
        return { ok: false, code: 'fetch-failed', message: `HTTP ${response.status}` }
      }
      const body = await response.json() as WireBalanceResponse
      const info = body.balance_infos?.find(item => (item.currency ?? '').toUpperCase() === 'CNY')
        ?? body.balance_infos?.[0]
      if (info === undefined || info.total_balance === undefined) {
        return { ok: false, code: 'fetch-failed', message: 'balance response carries no balance_infos' }
      }
      return {
        ok: true,
        isAvailable: body.is_available ?? true,
        currency: info.currency ?? 'CNY',
        totalBalance: wireAmount(info.total_balance),
        grantedBalance: wireAmount(info.granted_balance),
        toppedUpBalance: wireAmount(info.topped_up_balance),
      }
    } catch (error) {
      return {
        ok: false,
        code: 'fetch-failed',
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

export default DeepSeekBalanceService
