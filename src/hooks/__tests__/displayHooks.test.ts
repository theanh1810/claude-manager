import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDelayedFlag } from '../useDelayedFlag'
import { useMediaQuery } from '../useMediaQuery'

describe('useDelayedFlag', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('turns true only after its delay', () => {
    const { result } = renderHook(() => useDelayedFlag(true, 120))
    expect(result.current).toBe(false)
    act(() => {
      vi.advanceTimersByTime(119)
    })
    expect(result.current).toBe(false)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toBe(true)
  })

  it('defaults to 120ms', () => {
    const { result } = renderHook(() => useDelayedFlag(true))
    act(() => {
      vi.advanceTimersByTime(120)
    })
    expect(result.current).toBe(true)
  })

  it('goes false at once when the work ends and never flips for work shorter than the delay', () => {
    const { result, rerender } = renderHook(({ on }) => useDelayedFlag(on, 120), { initialProps: { on: true } })
    act(() => {
      vi.advanceTimersByTime(60)
    })
    rerender({ on: false })
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(result.current).toBe(false)
    rerender({ on: true })
    expect(result.current).toBe(false)
    act(() => {
      vi.advanceTimersByTime(120)
    })
    expect(result.current).toBe(true)
    rerender({ on: false })
    expect(result.current).toBe(false)
  })

  it('stays false while inactive', () => {
    const { result } = renderHook(() => useDelayedFlag(false, 120))
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current).toBe(false)
  })
})

describe('useMediaQuery', () => {
  const realMatchMedia = window.matchMedia
  let listeners: Set<() => void>
  let matches: Record<string, boolean>

  beforeEach(() => {
    listeners = new Set()
    matches = { '(max-width: 1099px)': false, '(min-width: 1100px)': true }
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      get matches() {
        return matches[query] ?? false
      },
      media: query,
      addEventListener: (_: string, l: () => void) => listeners.add(l),
      removeEventListener: (_: string, l: () => void) => listeners.delete(l)
    }))
  })
  afterEach(() => {
    window.matchMedia = realMatchMedia
  })

  it('reads the current match', () => {
    const { result } = renderHook(() => useMediaQuery('(min-width: 1100px)'))
    expect(result.current).toBe(true)
  })

  it('follows a matchMedia change without a remount', () => {
    const { result } = renderHook(() => useMediaQuery('(max-width: 1099px)'))
    expect(result.current).toBe(false)
    matches['(max-width: 1099px)'] = true
    act(() => listeners.forEach((l) => l()))
    expect(result.current).toBe(true)
    matches['(max-width: 1099px)'] = false
    act(() => listeners.forEach((l) => l()))
    expect(result.current).toBe(false)
  })

  it('reads the new query when it changes and unsubscribes on unmount', () => {
    const { result, rerender, unmount } = renderHook(({ q }) => useMediaQuery(q), { initialProps: { q: '(max-width: 1099px)' } })
    expect(result.current).toBe(false)
    rerender({ q: '(min-width: 1100px)' })
    expect(result.current).toBe(true)
    unmount()
    expect(listeners.size).toBe(0)
  })
})
