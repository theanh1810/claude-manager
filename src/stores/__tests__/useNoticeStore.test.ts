import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useNoticeStore } from '../useNoticeStore'

const notify = (n: Parameters<ReturnType<typeof useNoticeStore.getState>['notify']>[0]) => useNoticeStore.getState().notify(n)
const ids = () => useNoticeStore.getState().notices.map((n) => n.id)

beforeEach(() => {
  vi.useFakeTimers()
  useNoticeStore.getState().clear()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useNoticeStore', () => {
  it('notify returns an id and stores the notice', () => {
    const id = notify({ tone: 'info', children: 'Xong' })
    expect(ids()).toEqual([id])
    expect(useNoticeStore.getState().notices[0].tone).toBe('info')
  })

  it('notify with the same id replaces the earlier notice', () => {
    notify({ id: 'bulk', tone: 'danger', children: 'lần 1' })
    notify({ id: 'other', tone: 'info', children: 'khác' })
    notify({ id: 'bulk', tone: 'success', children: 'lần 2' })
    const list = useNoticeStore.getState().notices
    expect(list.filter((n) => n.id === 'bulk')).toHaveLength(1)
    expect(list.find((n) => n.id === 'bulk')?.children).toBe('lần 2')
    expect(ids()).toEqual(['other', 'bulk'])
  })

  it('keeps at most three notices and drops the oldest', () => {
    for (const id of ['a', 'b', 'c', 'd']) notify({ id, tone: 'info', children: id })
    expect(ids()).toEqual(['b', 'c', 'd'])
  })

  it('a notice with autoHideMs leaves after that time and one without it stays', () => {
    notify({ id: 'quick', tone: 'success', children: 'ok', autoHideMs: 3000 })
    notify({ id: 'sticky', tone: 'danger', children: 'lỗi' })
    vi.advanceTimersByTime(2999)
    expect(ids()).toEqual(['quick', 'sticky'])
    vi.advanceTimersByTime(1)
    expect(ids()).toEqual(['sticky'])
    vi.advanceTimersByTime(60_000)
    expect(ids()).toEqual(['sticky'])
  })

  it('replacing a notice cancels the timer of the old one', () => {
    notify({ id: 'a', tone: 'success', children: 'x', autoHideMs: 1000 })
    notify({ id: 'a', tone: 'danger', children: 'y' })
    vi.advanceTimersByTime(5000)
    expect(ids()).toEqual(['a'])
  })

  it('dismiss removes one notice and clear removes all', () => {
    notify({ id: 'a', tone: 'info', children: 'a' })
    notify({ id: 'b', tone: 'info', children: 'b' })
    useNoticeStore.getState().dismiss('a')
    expect(ids()).toEqual(['b'])
    useNoticeStore.getState().clear()
    expect(ids()).toEqual([])
  })

  it('a dismissed notice does not come back when its timer would have fired', () => {
    notify({ id: 'a', tone: 'success', children: 'x', autoHideMs: 1000 })
    useNoticeStore.getState().dismiss('a')
    notify({ id: 'a', tone: 'danger', children: 'again' })
    vi.advanceTimersByTime(1000)
    expect(ids()).toEqual(['a'])
  })
})
