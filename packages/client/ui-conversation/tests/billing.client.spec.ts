// Client-side token billing: CNY pricing, cost folding, and compact amounts.

import { describe, expect, it } from 'vitest'
import { DEFAULT_CNY_PRICING, formatCNY, priceBuckets } from '../src/client/chat/billing.ts'

describe('priceBuckets', () => {
  it('prices each disjoint bucket at its per-1M rate', () => {
    const buckets = { uncachedInputTokens: 1_000_000, outputTokens: 500_000, cacheReadTokens: 2_000_000, cacheWriteTokens: 0 }
    expect(priceBuckets(buckets, DEFAULT_CNY_PRICING)).toBe(2 + 8 * 0.5 + 0.5 * 2)
  })

  it('treats cache writes as free under the DeepSeek default', () => {
    const buckets = { uncachedInputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 1_000_000 }
    expect(priceBuckets(buckets, DEFAULT_CNY_PRICING)).toBe(2)
  })

  it('scales to fractional yuan for small sessions', () => {
    const buckets = { uncachedInputTokens: 10, outputTokens: 5, cacheReadTokens: 90, cacheWriteTokens: 0 }
    expect(priceBuckets(buckets, DEFAULT_CNY_PRICING)).toBe(105 / 1_000_000)
  })

  it('accepts a custom pricing table', () => {
    const pricing = { uncachedInputCNY: 1, cacheReadCNY: 0.2, cacheWriteCNY: 0.1, outputCNY: 4 }
    const buckets = { uncachedInputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 }
    expect(priceBuckets(buckets, pricing)).toBe(5)
  })
})

describe('formatCNY', () => {
  it('formats four significant digits, keeping small per-answer costs readable', () => {
    expect(formatCNY(0.0042)).toBe('¥0.0042')
    expect(formatCNY(0.000105)).toBe('¥0.000105')
    expect(formatCNY(12.345)).toBe('¥12.35')
  })

  it('prints zero for non-positive and non-finite amounts', () => {
    expect(formatCNY(0)).toBe('¥0')
    expect(formatCNY(-1)).toBe('¥0')
    expect(formatCNY(Number.NaN)).toBe('¥0')
    expect(formatCNY(Number.POSITIVE_INFINITY)).toBe('¥0')
  })
})
