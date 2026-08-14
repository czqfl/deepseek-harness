/**
 * Client-side token billing: CNY pricing and cost folding over provider usage.
 * The pricing table is a documented default — DeepSeek is the only provider
 * this harness ships, and its prices change rarely; the constant is the single
 * place to update them (official page:
 * https://api-docs.deepseek.com/zh-cn/quick_start/pricing).
 */

/** CNY per 1M tokens for each disjoint billing bucket. */
export interface TokenPricing {
  /** CNY per 1M uncached input tokens. */
  uncachedInputCNY: number
  /** CNY per 1M cache-read input tokens. */
  cacheReadCNY: number
  /** CNY per 1M cache-write input tokens. */
  cacheWriteCNY: number
  /** CNY per 1M output tokens. */
  outputCNY: number
}

/**
 * DeepSeek official CNY pricing per 1M tokens (deepseek-chat family, 2026-08).
 * DeepSeek does not bill cache writes, so that bucket prices at ¥0.
 */
export const DEFAULT_CNY_PRICING: TokenPricing = {
  uncachedInputCNY: 2,
  cacheReadCNY: 0.5,
  cacheWriteCNY: 0,
  outputCNY: 8,
}

/**
 * Price one disjoint bucket sum (a session's `tokenUsage` projection or one
 * turn's folded usage).
 * @param buckets - disjoint token counts.
 * @param pricing - CNY per 1M tokens.
 * @returns total cost in CNY.
 */
export function priceBuckets(
  buckets: { readonly uncachedInputTokens: number; readonly outputTokens: number; readonly cacheReadTokens: number; readonly cacheWriteTokens: number },
  pricing: TokenPricing,
): number {
  return (buckets.uncachedInputTokens * pricing.uncachedInputCNY
    + buckets.cacheReadTokens * pricing.cacheReadCNY
    + buckets.cacheWriteTokens * pricing.cacheWriteCNY
    + buckets.outputTokens * pricing.outputCNY) / 1_000_000
}

/**
 * Compact CNY amount: four significant digits, so a ¥0.0042 answer stays
 * readable while a ¥12.345 session total keeps its cents. Zero and negative
 * amounts print as ¥0.
 * @param cny - cost in CNY.
 * @returns display string.
 */
export function formatCNY(cny: number): string {
  if (!Number.isFinite(cny) || cny <= 0) return '¥0'
  return `¥${Number(cny.toPrecision(4)).toString()}`
}
