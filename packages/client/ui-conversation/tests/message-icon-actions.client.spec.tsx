// @vitest-environment jsdom
// MessageIconActions clock line: the per-turn cost chip renders after the
// throughput reading and only when the turn carried provider usage.

import { describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { MessageIconActions, type MessageIconActionsProps } from '../src/client/chat/MessageIconActions.tsx'
import { zh } from '../src/client/locales.ts'

const t: MessageIconActionsProps['t'] = makeTranslate(zh, commonZh)

function base(): MessageIconActionsProps {
  return { text: 'hi', clock: 'end', t }
}

describe('MessageIconActions cost chip', () => {
  it('renders the cost reading after throughput when provided', () => {
    const view = render(<MessageIconActions {...base()} time={1_000} tokensPerSecond={12} costCNY="¥0.0042" />)
    expect(view.container.textContent).toContain('费用 ¥0.0042')
    cleanup()
  })

  it('omits the cost chip when the turn reported no usage', () => {
    const view = render(<MessageIconActions {...base()} time={1_000} tokensPerSecond={12} />)
    expect(view.container.textContent).not.toContain('¥')
    cleanup()
  })
})
