import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { api } from '@/lib/ipc'
import { ConfirmProvider } from '@/components/ui/ConfirmProvider'
import { useEditDecision, useDecisionStatus, LEGACY_CONFIRM_CODE, LEGACY_CONFIRM_TEXT } from '../useEditDecision'

vi.mock('@/lib/ipc', () => ({
  api: { acceptEdit: vi.fn(), rejectEdit: vi.fn(), rollbackEdit: vi.fn() }
}))

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function setup(onAfter: () => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>
      <ConfirmProvider>{children}</ConfirmProvider>
    </QueryClientProvider>
  )
  return renderHook(({ id }) => ({ decision: useEditDecision(id, onAfter), status: useDecisionStatus(id) }), {
    wrapper,
    initialProps: { id: 'e1' }
  })
}

describe('useEditDecision per-call callbacks (T3, review N1)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  for (const kind of ['accept', 'reject'] as const) {
    const fn = kind === 'accept' ? 'acceptEdit' : 'rejectEdit'

    it(`${kind}: onDone fires once although the id changed before the call resolved`, async () => {
      const d = deferred<void>()
      vi.mocked(api[fn]).mockReturnValue(d.promise)
      const onDone = vi.fn()
      const onError = vi.fn()
      const { result, rerender } = setup(() => {})
      act(() => result.current.decision[kind]({ onDone, onError }))
      rerender({ id: 'e2' })
      await act(async () => {
        d.resolve()
        await d.promise
      })
      await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
      expect(onError).not.toHaveBeenCalled()
    })

    it(`${kind}: onError fires once on rejection after the id changed`, async () => {
      const d = deferred<void>()
      vi.mocked(api[fn]).mockReturnValue(d.promise)
      const onDone = vi.fn()
      const onError = vi.fn()
      const { result, rerender } = setup(() => {})
      act(() => result.current.decision[kind]({ onDone, onError }))
      rerender({ id: 'e2' })
      await act(async () => {
        d.reject('boom')
        await d.promise.catch(() => {})
      })
      await waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
      expect(onDone).not.toHaveBeenCalled()
    })
  }
})

describe('useEditDecision decisions and the in-app questions', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('UC-001/AC-4 rejecting calls reject_edit once, without asking, and advances after the refresh', async () => {
    vi.mocked(api.rejectEdit).mockResolvedValue(undefined)
    const onAfter = vi.fn()
    const { result } = setup(onAfter)
    act(() => result.current.decision.reject())
    await waitFor(() => expect(onAfter).toHaveBeenCalledTimes(1))
    expect(api.rejectEdit).toHaveBeenCalledTimes(1)
    expect(api.rejectEdit).toHaveBeenCalledWith('e1', false)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('UC-001/AC-9 accepting calls accept_edit once and advances', async () => {
    vi.mocked(api.acceptEdit).mockResolvedValue(undefined)
    const onAfter = vi.fn()
    const { result } = setup(onAfter)
    act(() => result.current.decision.accept())
    await waitFor(() => expect(onAfter).toHaveBeenCalledTimes(1))
    expect(api.acceptEdit).toHaveBeenCalledWith('e1')
  })

  it('UC-001/AC-9 accepting a change that is no longer pending fails with the backend text and does not advance', async () => {
    vi.mocked(api.acceptEdit).mockRejectedValue('cannot accept edit with status rejected')
    const onAfter = vi.fn()
    const onError = vi.fn()
    const { result } = setup(onAfter)
    act(() => result.current.decision.accept({ onError }))
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    expect(result.current.status.error).toBe('cannot accept edit with status rejected')
    expect(onAfter).not.toHaveBeenCalled()
  })

  it('UC-001/E3 a file edited after the change is not restored: the backend text is shown as it is', async () => {
    vi.mocked(api.rejectEdit).mockRejectedValue('File đã đổi sau thay đổi này')
    const { result } = setup(() => {})
    act(() => result.current.decision.reject())
    await waitFor(() => expect(result.current.status.error).toBe('File đã đổi sau thay đổi này'))
  })

  it('UC-001/AC-10 rolling back asks in a dialog first and calls rollback_edit only after the confirm', async () => {
    vi.mocked(api.rollbackEdit).mockResolvedValue(undefined)
    const { result } = setup(() => {})
    act(() => {
      void result.current.decision.rollback()
    })
    const dialog = await screen.findByRole('dialog', { name: 'Hoàn tác thay đổi đã chấp nhận?' })
    expect(dialog).toHaveTextContent('File hiện tại sẽ được đưa về nội dung trước thay đổi. App giữ một bản sao nội dung hiện tại.')
    expect(api.rollbackEdit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Hoàn tác' }))
    await waitFor(() => expect(api.rollbackEdit).toHaveBeenCalledWith('e1', false))
  })

  it('UC-001/AC-10 cancelling the rollback question calls nothing', async () => {
    const { result } = setup(() => {})
    act(() => {
      void result.current.decision.rollback()
    })
    await screen.findByRole('dialog', { name: 'Hoàn tác thay đổi đã chấp nhận?' })
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(api.rollbackEdit).not.toHaveBeenCalled()
  })

  it('UC-001/E4 an old change that differs asks first with the pinned text, and the confirm calls again with confirmLegacy', async () => {
    vi.mocked(api.rejectEdit).mockRejectedValueOnce(LEGACY_CONFIRM_CODE).mockResolvedValueOnce(undefined)
    const onAfter = vi.fn()
    const { result } = setup(onAfter)
    act(() => result.current.decision.reject())
    const dialog = await screen.findByRole('dialog', { name: 'Khôi phục thay đổi cũ?' })
    expect(dialog).toHaveTextContent(LEGACY_CONFIRM_TEXT)
    fireEvent.click(screen.getByRole('button', { name: 'Vẫn khôi phục' }))
    await waitFor(() => expect(api.rejectEdit).toHaveBeenLastCalledWith('e1', true))
    await waitFor(() => expect(onAfter).toHaveBeenCalledTimes(1))
  })

  it('UC-001/E4 cancelling the old-change question restores nothing and shows no error', async () => {
    vi.mocked(api.rejectEdit).mockRejectedValueOnce(LEGACY_CONFIRM_CODE)
    const onAfter = vi.fn()
    const { result } = setup(onAfter)
    act(() => result.current.decision.reject())
    await screen.findByRole('dialog', { name: 'Khôi phục thay đổi cũ?' })
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(api.rejectEdit).toHaveBeenCalledTimes(1)
    expect(result.current.status.error).toBeNull()
    expect(onAfter).not.toHaveBeenCalled()
  })
})
