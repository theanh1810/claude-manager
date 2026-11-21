import { describe, it, expect, beforeEach } from 'vitest'
import { useReviewFilterStore } from '../useReviewFilterStore'

describe('useReviewFilterStore', () => {
  beforeEach(() => {
    useReviewFilterStore.setState({ claudeOnly: { pending: false, history: false }, sessionId: null })
  })

  it('starts with no filter', () => {
    const s = useReviewFilterStore.getState()
    expect(s.claudeOnly).toEqual({ pending: false, history: false })
    expect(s.sessionId).toBeNull()
  })

  it('keeps the Claude-only toggle per tab', () => {
    useReviewFilterStore.getState().setClaudeOnly('pending', true)
    expect(useReviewFilterStore.getState().claudeOnly).toEqual({ pending: true, history: false })
    useReviewFilterStore.getState().setClaudeOnly('pending', false)
    expect(useReviewFilterStore.getState().claudeOnly.pending).toBe(false)
  })

  it('sets and clears the shared session filter', () => {
    useReviewFilterStore.getState().setSessionId('s-1')
    expect(useReviewFilterStore.getState().sessionId).toBe('s-1')
    useReviewFilterStore.getState().setSessionId(null)
    expect(useReviewFilterStore.getState().sessionId).toBeNull()
  })
})
