// Component tests for EditDetailPanel.
//
// Verifies the action-button state machine that the bug-prone Accept/Reject/
// Rollback flow depends on. Real diff rendering is handled by DiffView and
// covered by its own test.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'
import { readFileSync } from 'node:fs'
import EditDetailPanel from './EditDetailPanel'
import { ConfirmProvider } from '@/components/ui/ConfirmProvider'
import NoticeHost from '@/components/ui/NoticeHost'
import { useNoticeStore } from '@/stores/useNoticeStore'
import { LEGACY_CONFIRM_CODE, LEGACY_CONFIRM_TEXT } from './useEditDecision'
import type { Edit, EditStatus } from '@/types/edit'

const invokeMock = vi.mocked(invoke)

/** The command names in the `generate_handler!` list of src-tauri/src/app.rs. */
function registeredCommands(): string[] {
  const src = readFileSync('src-tauri/src/app.rs', 'utf8')
  const rest = src.slice(src.indexOf('generate_handler![') + 'generate_handler!['.length)
  return rest
    .slice(0, rest.indexOf('])'))
    .split('\n')
    .map((line) => line.trim().replace(/,$/, ''))
    .filter((line) => line !== '' && !line.startsWith('//'))
    .map((line) => line.split('::').pop() as string)
}

function makeEdit(status: EditStatus, over: Partial<Edit> = {}): Edit {
  return {
    id: 'detail-1',
    session_id: 'session-1',
    tool: 'Edit',
    path: '/abs/project/example.ts',
    before_blob_sha: 'before-sha',
    after_blob_sha: 'after-sha',
    status,
    hook_phase: 'post',
    created_at: '2026-06-30T10:00:00Z',
    decided_at: null,
    explanation_md: null,
    explanation_cached_at: null,
    rollback_of_edit_id: null,
    ...over
  }
}

function renderWithClient(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  })
  return render(
    <QueryClientProvider client={qc}>
      <ConfirmProvider>
        {ui}
        <NoticeHost />
      </ConfirmProvider>
    </QueryClientProvider>
  )
}

/**
 * Wire invoke so it answers the two queries EditDetailPanel makes
 * (`get_edit` + `get_edit_diff`) plus any subsequent action invocations.
 */
function wireQueries(edit: Edit, diff = { before: 'a', after: 'b', path: edit.path }) {
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === 'get_edit') return Promise.resolve(edit)
    if (cmd === 'get_edit_diff') return Promise.resolve(diff)
    if (cmd === 'list_projects' || cmd === 'list_edits') return Promise.resolve([])
    // Default for action invocations (accept_edit / reject_edit / rollback_edit).
    return Promise.resolve(undefined)
  })
}

/** Like wireQueries, but the commands in `failing` reject once per queued value, then succeed. */
function wireFailing(edit: Edit, failing: Record<string, unknown[]>) {
  const queued = Object.fromEntries(Object.entries(failing).map(([k, v]) => [k, [...v]]))
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === 'get_edit') return Promise.resolve(edit)
    if (cmd === 'get_edit_diff') return Promise.resolve({ before: 'a', after: 'b', path: edit.path })
    if (cmd === 'list_projects' || cmd === 'list_edits') return Promise.resolve([])
    if (queued[cmd]?.length) return Promise.reject(queued[cmd].shift())
    return Promise.resolve(undefined)
  })
}

/** Like wireQueries with the given diff; each command in `extra` always rejects with its value. */
function wireDiff(edit: Edit, diff: { before: string; after: string }, extra: Record<string, unknown> = {}) {
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd in extra) return Promise.reject(extra[cmd])
    if (cmd === 'get_edit') return Promise.resolve(edit)
    if (cmd === 'get_edit_diff') return Promise.resolve({ ...diff, path: edit.path })
    if (cmd === 'list_projects' || cmd === 'list_edits') return Promise.resolve([])
    return Promise.resolve(undefined)
  })
}

const dialogButton = async (name: string) => within(await screen.findByRole('dialog')).getByRole('button', { name })

describe('<EditDetailPanel />', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    useNoticeStore.getState().clear()
  })

  it('renders the empty state when editId is null', () => {
    invokeMock.mockImplementation((cmd: string) => Promise.resolve(cmd === 'list_edits' ? [] : undefined))
    renderWithClient(<EditDetailPanel editId={null} />)
    expect(screen.getByText('Chọn một thay đổi để xem chi tiết')).toBeInTheDocument()
    expect(screen.getByText(/Chọn một dòng ở danh sách bên trái/)).toBeInTheDocument()
  })

  it('shows the file path, tool and status mark once the change loads, in a fixed 108px header', async () => {
    wireQueries(makeEdit('pending'))
    const { container } = renderWithClient(<EditDetailPanel editId="detail-1" />)
    expect(await screen.findByText('/abs/project/example.ts')).toHaveAttribute('title', '/abs/project/example.ts')
    expect(screen.getByText('Edit')).toBeInTheDocument()
    expect(screen.getByText('Chờ')).toBeInTheDocument()
    expect(container.querySelector('header')).toHaveClass('h-detail-head', 'shrink-0')
  })

  it('all four buttons always render; a pending change enables Chấp nhận and Từ chối and disables Hoàn tác with its reason', async () => {
    wireQueries(makeEdit('pending'))
    renderWithClient(<EditDetailPanel editId="detail-1" />)
    const accept = await screen.findByRole('button', { name: 'Chấp nhận' })
    expect(accept).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Từ chối' })).toBeEnabled()
    const rollback = screen.getByRole('button', { name: 'Hoàn tác' })
    expect(rollback).toBeDisabled()
    expect(rollback).toHaveAttribute('title', 'Chỉ hoàn tác được thay đổi đã chấp nhận')
    expect(screen.getByRole('button', { name: 'Giải thích' })).toBeEnabled()
  })

  it('an accepted change disables Chấp nhận and Từ chối with their reason and enables Hoàn tác', async () => {
    wireQueries(makeEdit('accepted'))
    renderWithClient(<EditDetailPanel editId="detail-1" />)
    const accept = await screen.findByRole('button', { name: 'Chấp nhận' })
    const reject = screen.getByRole('button', { name: 'Từ chối' })
    expect(accept).toBeDisabled()
    expect(reject).toBeDisabled()
    expect(accept).toHaveAttribute('title', 'Chỉ áp dụng cho thay đổi đang chờ duyệt')
    expect(reject).toHaveAttribute('title', 'Chỉ áp dụng cho thay đổi đang chờ duyệt')
    expect(screen.getByRole('button', { name: 'Hoàn tác' })).toBeEnabled()
  })

  it('shows the key chips A and R, with their shortcuts, only when decisionKeys is set', async () => {
    wireQueries(makeEdit('pending'))
    const { unmount } = renderWithClient(<EditDetailPanel editId="detail-1" decisionKeys />)
    const accept = await screen.findByRole('button', { name: 'Chấp nhận' })
    expect(accept).toHaveAttribute('aria-keyshortcuts', 'A')
    expect(screen.getByRole('button', { name: 'Từ chối' })).toHaveAttribute('aria-keyshortcuts', 'R')
    unmount()
    renderWithClient(<EditDetailPanel editId="detail-1" />)
    expect(await screen.findByRole('button', { name: 'Chấp nhận' })).not.toHaveAttribute('aria-keyshortcuts')
  })

  it('clicking Chấp nhận invokes accept_edit then triggers onAfterDecision', async () => {
    wireQueries(makeEdit('pending'))
    const onAfter = vi.fn()
    renderWithClient(<EditDetailPanel editId="detail-1" onAfterDecision={onAfter} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Chấp nhận' }))
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('accept_edit', { id: 'detail-1' })
      expect(onAfter).toHaveBeenCalledTimes(1)
    })
  })

  it('clicking Từ chối invokes reject_edit', async () => {
    wireQueries(makeEdit('pending'))
    renderWithClient(<EditDetailPanel editId="detail-1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Từ chối' }))
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('reject_edit', { id: 'detail-1' }))
  })

  it('UC-001/AC-2 a Claude change is labelled with its session and decision', async () => {
    const e = makeEdit('pending')
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_edit') return Promise.resolve(e)
      if (cmd === 'get_edit_diff') return Promise.resolve({ before: 'a', after: 'b', path: e.path })
      if (cmd === 'list_projects' || cmd === 'change_maps_list') return Promise.resolve([])
      if (cmd === 'list_edits') return Promise.resolve([{ ...e, source: 'claude', session_id: 'abcd1234-ef', decision: 'accept' }])
      return Promise.resolve(undefined)
    })
    renderWithClient(<EditDetailPanel editId="detail-1" />)
    expect(await screen.findByText('Claude · session abcd1234')).toBeInTheDocument()
    expect(screen.getByText('được phép')).toBeInTheDocument()
  })

  it('shows không rõ when the change has no label', async () => {
    wireQueries(makeEdit('pending'))
    renderWithClient(<EditDetailPanel editId="detail-1" />)
    expect(await screen.findByText('không rõ / bạn tự sửa')).toBeInTheDocument()
  })

  it('UC-001/AC-17 replacing one line counts one added and one removed in the header', async () => {
    wireDiff(makeEdit('pending'), { before: 'a\nb\nc', after: 'a\nx\nc' })
    renderWithClient(<EditDetailPanel editId="detail-1" />)
    expect(await screen.findByText('+1')).toHaveClass('text-success-fg')
    expect(screen.getByText('-1')).toHaveClass('text-danger-fg')
  })

  it('UC-001/AC-17 appending two lines counts two added and none removed in the header', async () => {
    wireDiff(makeEdit('pending'), { before: 'a', after: 'a\nb\nc' })
    renderWithClient(<EditDetailPanel editId="detail-1" />)
    expect(await screen.findByText('+2')).toBeInTheDocument()
    expect(screen.getByText('-0')).toBeInTheDocument()
  })

  it('shows the diff and its toolbar once loaded, and a message when no line changed', async () => {
    wireDiff(makeEdit('pending'), { before: 'a\nb', after: 'a\nc' })
    const { unmount } = renderWithClient(<EditDetailPanel editId="detail-1" />)
    expect(await screen.findByRole('switch', { name: 'Chỉ dòng thay đổi' })).toBeInTheDocument()
    unmount()
    wireDiff(makeEdit('pending'), { before: 'same', after: 'same' })
    renderWithClient(<EditDetailPanel editId="detail-1" />)
    expect(await screen.findByText('Không có dòng nào thay đổi')).toBeInTheDocument()
  })

  it('a failed accept shows its reason as an alert notice and does not advance', async () => {
    wireFailing(makeEdit('pending'), { accept_edit: ['cannot accept edit with status rejected'] })
    const onAfter = vi.fn()
    renderWithClient(<EditDetailPanel editId="detail-1" onAfterDecision={onAfter} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Chấp nhận' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('cannot accept edit with status rejected')
    expect(useNoticeStore.getState().notices[0].id).toBe('decision-error:detail-1')
    expect(onAfter).not.toHaveBeenCalled()
  })

  it('UC-001/E3 a reject stopped because the file changed shows File đã đổi sau thay đổi này', async () => {
    wireFailing(makeEdit('pending'), { reject_edit: ['File đã đổi sau thay đổi này'] })
    renderWithClient(<EditDetailPanel editId="detail-1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Từ chối' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('File đã đổi sau thay đổi này')
  })

  it('the error notice closes when the next decision starts', async () => {
    wireFailing(makeEdit('pending'), { accept_edit: ['boom'] })
    renderWithClient(<EditDetailPanel editId="detail-1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Chấp nhận' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'Chấp nhận' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('UC-001/AC-10 a failed rollback shows its text and Hoàn tác stays available', async () => {
    wireFailing(makeEdit('accepted'), { rollback_edit: [new Error('disk full')] })
    const onAfter = vi.fn()
    renderWithClient(<EditDetailPanel editId="detail-1" onAfterDecision={onAfter} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Hoàn tác' }))
    fireEvent.click(await dialogButton('Hoàn tác'))
    expect(await screen.findByRole('alert')).toHaveTextContent('disk full')
    expect(screen.getByRole('button', { name: 'Hoàn tác' })).not.toBeDisabled()
    expect(onAfter).not.toHaveBeenCalled()
  })

  it('selecting another change clears the error notice', async () => {
    wireFailing(makeEdit('pending'), { accept_edit: ['cannot accept edit with status rejected'] })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const ui = (id: string) => (
      <QueryClientProvider client={qc}>
        <ConfirmProvider>
          <EditDetailPanel editId={id} />
          <NoticeHost />
        </ConfirmProvider>
      </QueryClientProvider>
    )
    const { rerender } = render(ui('detail-1'))
    fireEvent.click(await screen.findByRole('button', { name: 'Chấp nhận' }))
    await screen.findByRole('alert')
    rerender(ui('detail-2'))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('enables Chấp nhận and Từ chối for a pending_decision change', async () => {
    wireQueries(makeEdit('pending_decision'))
    renderWithClient(<EditDetailPanel editId="detail-1" />)
    expect(await screen.findByRole('button', { name: 'Chấp nhận' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Từ chối' })).toBeEnabled()
  })

  it('UC-001/E4 a legacy row asks first: the confirm calls reject_edit again with confirmLegacy true', async () => {
    wireFailing(makeEdit('pending_decision'), { reject_edit: [LEGACY_CONFIRM_CODE] })
    const onAfter = vi.fn()
    renderWithClient(<EditDetailPanel editId="detail-1" onAfterDecision={onAfter} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Từ chối' }))
    expect(await screen.findByRole('dialog', { name: 'Khôi phục thay đổi cũ?' })).toHaveTextContent(LEGACY_CONFIRM_TEXT)
    fireEvent.click(await dialogButton('Vẫn khôi phục'))
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('reject_edit', { id: 'detail-1', confirmLegacy: true }))
    expect(invokeMock).toHaveBeenCalledWith('reject_edit', { id: 'detail-1' })
    await waitFor(() => expect(onAfter).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('UC-001/E4 a legacy row: Hủy calls nothing more and shows no error line', async () => {
    wireFailing(makeEdit('pending_decision'), { reject_edit: [LEGACY_CONFIRM_CODE] })
    const onAfter = vi.fn()
    renderWithClient(<EditDetailPanel editId="detail-1" onAfterDecision={onAfter} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Từ chối' }))
    fireEvent.click(await dialogButton('Hủy'))
    const rejectCalls = () => invokeMock.mock.calls.filter((c) => c[0] === 'reject_edit')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(rejectCalls()).toHaveLength(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(onAfter).not.toHaveBeenCalled()
  })

  it('LEGACY_CONFIRM_CODE equals the code const in src-tauri/src/rollback.rs', () => {
    const rust = readFileSync('src-tauri/src/rollback.rs', 'utf8')
    const match = /LEGACY_CONFIRM: &str =\s*"([^"]+)"/.exec(rust)
    expect(match?.[1]).toBe(LEGACY_CONFIRM_CODE)
  })

  it('UC-001/AC-16 the edit detail shows no plan or task label', async () => {
    const edit = makeEdit('pending')
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_edit') return Promise.resolve(edit)
      if (cmd === 'get_edit_diff') return Promise.resolve({ before: 'a', after: 'b', path: edit.path })
      if (cmd === 'list_edits') return Promise.resolve([edit])
      if (cmd === 'list_projects') return Promise.resolve([{ id: 'p', name: 'demo', path: '/abs/project', color: null, added_at: '', last_opened_at: null }])
      return Promise.resolve(undefined)
    })
    renderWithClient(<EditDetailPanel editId="detail-1" />)
    expect(await screen.findByText('/abs/project/example.ts')).toBeInTheDocument()
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('list_edits', expect.anything()))
    expect(screen.queryByTestId('edit-plan-label')).toBeNull()
    expect(screen.queryByText(/Plan P/)).toBeNull()
    const registered = registeredCommands()
    for (const command of invokeMock.mock.calls.map((c) => c[0])) expect(registered).toContain(command)
  })

  it('UC-001/AC-10 Hoàn tác asks first and then calls rollback_edit for an accepted change', async () => {
    wireQueries(makeEdit('accepted'))
    renderWithClient(<EditDetailPanel editId="detail-1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Hoàn tác' }))
    expect(invokeMock).not.toHaveBeenCalledWith('rollback_edit', expect.anything())
    fireEvent.click(await dialogButton('Hoàn tác'))
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('rollback_edit', { id: 'detail-1' }))
  })
})

describe('<EditDetailPanel /> loading and failing', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    useNoticeStore.getState().clear()
  })

  it('a failed get_edit_diff shows "Không tải được nội dung thay đổi" with Thử lại, not a skeleton, and retries both reads', async () => {
    wireDiff(makeEdit('pending'), { before: 'a', after: 'b' }, { get_edit_diff: 'diff unreadable' })
    renderWithClient(<EditDetailPanel editId="detail-1" />)
    expect(await screen.findByText('Không tải được nội dung thay đổi')).toBeInTheDocument()
    expect(screen.getByText('diff unreadable')).toBeInTheDocument()
    expect(screen.queryByText('Đang tải…')).toBeNull()
    const reads = (cmd: string) => invokeMock.mock.calls.filter((c) => c[0] === cmd).length
    expect([reads('get_edit'), reads('get_edit_diff')]).toEqual([1, 1])
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }))
    await waitFor(() => expect([reads('get_edit'), reads('get_edit_diff')]).toEqual([2, 2]))
  })

  it('Accept and Reject stay disabled while the newly selected change still shows the previous diff', async () => {
    const one = makeEdit('pending', { id: 'detail-1', path: '/abs/project/one.ts' })
    const two = makeEdit('pending', { id: 'detail-2', path: '/abs/project/two.ts' })
    let releaseDiff: (v: unknown) => void = () => {}
    const held = new Promise((res) => { releaseDiff = res })
    invokeMock.mockImplementation((cmd: string, args?: unknown) => {
      const id = (args as { id?: string } | undefined)?.id
      if (cmd === 'get_edit') return Promise.resolve(id === 'detail-2' ? two : one)
      if (cmd === 'get_edit_diff') return id === 'detail-2' ? held : Promise.resolve({ before: 'a', after: 'b', path: one.path })
      if (cmd === 'list_projects' || cmd === 'list_edits') return Promise.resolve([])
      return Promise.resolve(undefined)
    })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const tree = (id: string) => (
      <QueryClientProvider client={qc}>
        <ConfirmProvider>
          <EditDetailPanel editId={id} />
        </ConfirmProvider>
      </QueryClientProvider>
    )
    const { rerender } = render(tree('detail-1'))
    expect(await screen.findByRole('button', { name: 'Chấp nhận' })).toBeEnabled()
    rerender(tree('detail-2'))
    expect(await screen.findByText('/abs/project/two.ts')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Chấp nhận' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Từ chối' })).toBeDisabled()
    releaseDiff({ before: 'c', after: 'd', path: two.path })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Chấp nhận' })).toBeEnabled())
    expect(screen.getByRole('button', { name: 'Từ chối' })).toBeEnabled()
  })

  it('a failed get_edit shows the same error state in place of the whole detail', async () => {
    wireDiff(makeEdit('pending'), { before: 'a', after: 'b' }, { get_edit: new Error('row missing') })
    renderWithClient(<EditDetailPanel editId="detail-1" />)
    expect(await screen.findByText('Không tải được nội dung thay đổi')).toBeInTheDocument()
    expect(screen.getByText('row missing')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Chấp nhận' })).toBeNull()
  })

  it('the skeleton appears only after 120 ms of loading', async () => {
    invokeMock.mockImplementation(() => new Promise(() => {}))
    renderWithClient(<EditDetailPanel editId="detail-1" />)
    expect(screen.queryByText('Đang tải…')).toBeNull()
    expect((await screen.findAllByText('Đang tải…')).length).toBeGreaterThan(0)
  })
})

describe('<EditDetailPanel /> explain panel', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    useNoticeStore.getState().clear()
  })

  it('"Giải thích" toggles the panel and exposes aria-expanded and aria-controls', async () => {
    wireDiff(makeEdit('pending', { explanation_md: 'Đã lưu **sẵn**.' }), { before: 'a', after: 'b' })
    renderWithClient(<EditDetailPanel editId="detail-1" />)
    const toggle = await screen.findByRole('button', { name: 'Giải thích' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveAttribute('aria-controls', 'explain-panel')
    fireEvent.click(toggle)
    expect(await screen.findByRole('complementary', { name: 'Claude giải thích' })).toHaveAttribute('id', 'explain-panel')
    expect(screen.getByRole('button', { name: 'Ẩn giải thích' })).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Đóng giải thích' }))
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('a stored explanation renders as markdown with no API call', async () => {
    wireDiff(makeEdit('pending', { explanation_md: '# Tổng quan\n\nĐã lưu **sẵn**.' }), { before: 'a', after: 'b' })
    renderWithClient(<EditDetailPanel editId="detail-1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Giải thích' }))
    expect(await screen.findByRole('heading', { level: 3, name: 'Tổng quan' })).toBeInTheDocument()
    expect(screen.getByText('sẵn').tagName).toBe('STRONG')
    expect(invokeMock).not.toHaveBeenCalledWith('explain_edit', expect.anything())
  })

  it('shows the call in progress, then the explanation, with one call per opening', async () => {
    let resolve!: (text: string) => void
    wireDiff(makeEdit('pending'), { before: 'a', after: 'b' })
    const base = invokeMock.getMockImplementation()!
    invokeMock.mockImplementation((cmd: string, args?: unknown) =>
      cmd === 'explain_edit' ? new Promise<string>((r) => (resolve = r)) : base(cmd, args as never)
    )
    renderWithClient(<EditDetailPanel editId="detail-1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Giải thích' }))
    expect(await screen.findByText('Đang gọi Anthropic API…')).toBeInTheDocument()
    resolve('Kết quả **mới**.')
    expect((await screen.findByText('mới')).tagName).toBe('STRONG')
    fireEvent.click(screen.getByRole('button', { name: 'Đóng giải thích' }))
    fireEvent.click(screen.getByRole('button', { name: 'Giải thích' }))
    expect(await screen.findByText('mới')).toBeInTheDocument()
    expect(invokeMock.mock.calls.filter((c) => c[0] === 'explain_edit')).toHaveLength(1)
  })

  it('a failed explanation shows the error with Thử lại, which calls once more, and Mở Cài đặt', async () => {
    const onOpenSettings = vi.fn()
    wireDiff(makeEdit('pending'), { before: 'a', after: 'b' }, { explain_edit: 'Chưa nhập Anthropic API key' })
    renderWithClient(<EditDetailPanel editId="detail-1" onOpenSettings={onOpenSettings} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Giải thích' }))
    expect(await screen.findByText('Không lấy được giải thích')).toBeInTheDocument()
    expect(screen.getByText('Chưa nhập Anthropic API key')).toBeInTheDocument()
    const calls = () => invokeMock.mock.calls.filter((c) => c[0] === 'explain_edit').length
    expect(calls()).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }))
    await waitFor(() => expect(calls()).toBe(2))
    fireEvent.click(await screen.findByRole('button', { name: 'Mở Cài đặt' }))
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
  })

  it('changing the change closes the panel', async () => {
    wireDiff(makeEdit('pending', { explanation_md: 'x' }), { before: 'a', after: 'b' })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const ui = (id: string) => (
      <QueryClientProvider client={qc}>
        <ConfirmProvider>
          <EditDetailPanel editId={id} />
        </ConfirmProvider>
      </QueryClientProvider>
    )
    const { rerender } = render(ui('detail-1'))
    fireEvent.click(await screen.findByRole('button', { name: 'Giải thích' }))
    await screen.findByRole('complementary')
    rerender(ui('detail-2'))
    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull())
  })
})
