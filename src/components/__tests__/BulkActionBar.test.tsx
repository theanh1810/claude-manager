import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'
import BulkActionBar from '../BulkActionBar'
import NoticeHost from '../ui/NoticeHost'
import { ConfirmProvider } from '../ui/ConfirmProvider'
import { useNoticeStore } from '@/stores/useNoticeStore'
import { useReviewFilterStore } from '@/stores/useReviewFilterStore'
import type { Edit } from '@/types/edit'

const invokeMock = vi.mocked(invoke)

const LEGACY_CONFIRM = 'LEGACY_CONFIRM'
const LEGACY_LINE = 'Thay đổi cũ, cần xác nhận riêng — mở mục này để từ chối'
const FILTER_REASON = 'Đang lọc — bỏ bộ lọc để duyệt hàng loạt'

function makeEdit(id: string, path: string): Edit {
  return {
    id,
    session_id: 's-1',
    tool: 'Edit',
    path,
    before_blob_sha: 'before-sha',
    after_blob_sha: 'after-sha',
    status: 'pending',
    hook_phase: 'post',
    created_at: '2026-06-30T10:00:00Z',
    decided_at: null,
    explanation_md: null,
    explanation_cached_at: null,
    rollback_of_edit_id: null
  }
}

type Bulk = {
  cmd: 'accept_all' | 'reject_all'
  result?: { success: number; failed: number; errors: string[] }
  error?: unknown
}

function wire(bulk: Bulk, rows: Edit[] = []) {
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === 'list_edits') return Promise.resolve(rows)
    if (cmd === bulk.cmd) return 'error' in bulk ? Promise.reject(bulk.error) : Promise.resolve(bulk.result)
    return Promise.resolve(undefined)
  })
}

type BarProps = Partial<React.ComponentProps<typeof BulkActionBar>>

function bar(qc: QueryClient, props: BarProps = {}) {
  return (
    <QueryClientProvider client={qc}>
      <ConfirmProvider>
        <BulkActionBar pendingCount={3} projectPath={null} projectName={null} {...props} />
        <NoticeHost />
      </ConfirmProvider>
    </QueryClientProvider>
  )
}

function renderBar(props: BarProps = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return { qc, ...render(bar(qc, props)) }
}

/** Opens the question of a bulk button and presses its confirm button. */
async function ask(button: RegExp, confirmName: string) {
  fireEvent.click(screen.getByRole('button', { name: button }))
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: confirmName }))
}

const ACCEPT = /Chấp nhận tất cả/
const REJECT = /Từ chối tất cả/

beforeEach(() => {
  invokeMock.mockReset()
  useNoticeStore.getState().clear()
  useReviewFilterStore.setState({ claudeOnly: { pending: false, history: false }, sessionId: null })
})

describe('<BulkActionBar /> buttons', () => {
  it('always renders both buttons: enabled with pending changes and no filter', () => {
    renderBar()
    expect(screen.getByRole('button', { name: ACCEPT })).toBeEnabled()
    expect(screen.getByRole('button', { name: REJECT })).toBeEnabled()
  })

  it('UC-001/AC-7 bulk buttons are disabled under a filter, with the pinned reason as their title', () => {
    useReviewFilterStore.setState({ claudeOnly: { pending: true, history: false }, sessionId: null })
    renderBar()
    for (const name of [ACCEPT, REJECT]) {
      const b = screen.getByRole('button', { name })
      expect(b).toBeDisabled()
      expect(b).toHaveAttribute('title', FILTER_REASON)
    }
  })

  it('UC-001/AC-7 a session filter disables them too', () => {
    useReviewFilterStore.setState({ claudeOnly: { pending: false, history: false }, sessionId: 'sess-1' })
    renderBar()
    expect(screen.getByRole('button', { name: ACCEPT })).toHaveAttribute('title', FILTER_REASON)
  })

  it('the History toggle does not disable them', () => {
    useReviewFilterStore.setState({ claudeOnly: { pending: false, history: true }, sessionId: null })
    renderBar()
    expect(screen.getByRole('button', { name: ACCEPT })).toBeEnabled()
  })

  it('with nothing pending both stay on screen, disabled, with the reason as their title', () => {
    renderBar({ pendingCount: 0 })
    for (const name of [ACCEPT, REJECT]) {
      const b = screen.getByRole('button', { name })
      expect(b).toBeDisabled()
      expect(b).toHaveAttribute('title', 'Không có thay đổi nào đang chờ duyệt')
    }
  })
})

describe('<BulkActionBar /> the question', () => {
  it('UC-001/AC-11 accept-all asks in the app dialog with the count and the scope TẤT CẢ project', async () => {
    wire({ cmd: 'accept_all', result: { success: 3, failed: 0, errors: [] } })
    renderBar()
    fireEvent.click(screen.getByRole('button', { name: ACCEPT }))
    const dialog = await screen.findByRole('dialog', { name: 'Chấp nhận tất cả 3 thay đổi đang chờ?' })
    expect(dialog).toHaveTextContent('Áp dụng cho TẤT CẢ project. File giữ nguyên nội dung hiện tại.')
    expect(invokeMock).not.toHaveBeenCalledWith('accept_all', expect.anything())
  })

  it('UC-001/AC-11 reject-all asks with a danger dialog naming the selected project as its scope', async () => {
    wire({ cmd: 'reject_all', result: { success: 3, failed: 0, errors: [] } })
    renderBar({ projectName: 'demo', projectPath: '/abs/demo' })
    fireEvent.click(screen.getByRole('button', { name: REJECT }))
    const dialog = await screen.findByRole('dialog', { name: 'Từ chối và hoàn tác tất cả 3 thay đổi đang chờ?' })
    expect(dialog).toHaveTextContent('Áp dụng cho project "demo". File sẽ được khôi phục về trạng thái trước thay đổi.')
    expect(screen.getByRole('button', { name: 'Hủy' })).toHaveFocus()
  })

  it('cancelling either question calls nothing', async () => {
    wire({ cmd: 'accept_all', result: { success: 3, failed: 0, errors: [] } })
    renderBar()
    for (const name of [ACCEPT, REJECT]) {
      fireEvent.click(screen.getByRole('button', { name }))
      await screen.findByRole('dialog')
      fireEvent.click(screen.getByRole('button', { name: 'Hủy' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    }
    expect(invokeMock).not.toHaveBeenCalledWith('accept_all', expect.anything())
    expect(invokeMock).not.toHaveBeenCalledWith('reject_all', expect.anything())
    expect(useNoticeStore.getState().notices).toHaveLength(0)
  })

  it('no window.confirm is used', async () => {
    const spy = vi.spyOn(window, 'confirm')
    wire({ cmd: 'accept_all', result: { success: 3, failed: 0, errors: [] } })
    renderBar()
    await ask(ACCEPT, 'Chấp nhận tất cả')
    await screen.findByText('Đã chấp nhận 3 mục')
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('<BulkActionBar /> result notice', () => {
  it('accept-all with every change accepted reports the count and leaves after 3 s', async () => {
    wire({ cmd: 'accept_all', result: { success: 3, failed: 0, errors: [] } })
    renderBar()
    await ask(ACCEPT, 'Chấp nhận tất cả')
    expect(await screen.findByText('Đã chấp nhận 3 mục')).toBeInTheDocument()
    expect(screen.queryByText(/không xử lý được/)).not.toBeInTheDocument()
    expect(useNoticeStore.getState().notices[0]).toMatchObject({ tone: 'success', autoHideMs: 3000 })
  })

  it('UC-001/AC-11 reject-all reports a failing row under the head with the file path, and stays', async () => {
    wire(
      { cmd: 'reject_all', result: { success: 2, failed: 1, errors: ['e-9: File đã đổi sau thay đổi này'] } },
      [makeEdit('e-9', '/abs/proj/a.ts')]
    )
    const { qc } = renderBar()
    await qc.prefetchQuery({ queryKey: ['edits', 'all'], queryFn: () => invokeMock('list_edits', { limit: 5000 }) as Promise<Edit[]> })
    await ask(REJECT, 'Từ chối tất cả')
    expect(await screen.findByText('Đã từ chối 2 mục')).toBeInTheDocument()
    expect(screen.getByText('1 mục không xử lý được:')).toBeInTheDocument()
    expect(screen.getByText('proj/a.ts: File đã đổi sau thay đổi này')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    const notice = useNoticeStore.getState().notices[0]
    expect(notice.tone).toBe('danger')
    expect(notice.autoHideMs).toBeUndefined()
  })

  it('a failed id that is not in the loaded list shows the id', async () => {
    wire({ cmd: 'accept_all', result: { success: 0, failed: 1, errors: ['ghost-1: cannot accept edit with status rejected'] } })
    renderBar()
    await ask(ACCEPT, 'Chấp nhận tất cả')
    expect(await screen.findByText('ghost-1: cannot accept edit with status rejected')).toBeInTheDocument()
  })

  it('a whole-call failure shows its error text as a danger notice', async () => {
    wire({ cmd: 'accept_all', error: 'database is locked' })
    renderBar()
    await ask(ACCEPT, 'Chấp nhận tất cả')
    expect(await screen.findByText('database is locked')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('UC-001/AC-11 reject-all leaves an old change for a separate decision, with the short how-to line', async () => {
    wire({ cmd: 'reject_all', result: { success: 2, failed: 1, errors: [`e-7: ${LEGACY_CONFIRM}`] } })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(['edits', 'all'], [makeEdit('e-7', '/abs/proj/old.ts')])
    render(bar(qc))
    await ask(REJECT, 'Từ chối tất cả')
    expect(await screen.findByText(`proj/old.ts: ${LEGACY_LINE}`)).toBeInTheDocument()
    expect(screen.getByText('1 mục không xử lý được:')).toBeInTheDocument()
    expect(screen.getByText('Đã từ chối 2 mục')).toBeInTheDocument()
    expect(screen.queryByText('Đã từ chối 3 mục')).not.toBeInTheDocument()
  })

  it('keeps the result on screen when the accepted changes leave the list empty', async () => {
    wire({ cmd: 'accept_all', result: { success: 3, failed: 0, errors: [] } })
    const { qc, rerender } = renderBar()
    await ask(ACCEPT, 'Chấp nhận tất cả')
    await screen.findByText('Đã chấp nhận 3 mục')
    rerender(bar(qc, { pendingCount: 0 }))
    expect(screen.getByText('Đã chấp nhận 3 mục')).toBeInTheDocument()
  })

  it('a second result replaces the first instead of stacking', async () => {
    wire({ cmd: 'accept_all', result: { success: 3, failed: 0, errors: [] } })
    renderBar()
    await ask(ACCEPT, 'Chấp nhận tất cả')
    await screen.findByText('Đã chấp nhận 3 mục')
    wire({ cmd: 'accept_all', result: { success: 1, failed: 0, errors: [] } })
    await ask(ACCEPT, 'Chấp nhận tất cả')
    await screen.findByText('Đã chấp nhận 1 mục')
    expect(screen.queryByText('Đã chấp nhận 3 mục')).toBeNull()
  })
})
