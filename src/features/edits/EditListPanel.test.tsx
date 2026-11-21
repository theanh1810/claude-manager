// Component tests for EditListPanel.
//
// Verifies the list-rendering contract that the parent App.tsx depends on:
//   - active vs history status filter is applied
//   - project path prefix filter is applied
//   - search input narrows the visible rows
//   - the list is a virtualised listbox whose selection follows the keyboard
//   - empty and error states are told apart
// jsdom has no layout, so every element gets a 320 x 600 box for the virtual list.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'
import EditListPanel, { resetIndexThrottle } from './EditListPanel'
import { useReviewFilterStore } from '@/stores/useReviewFilterStore'
import type { Edit } from '@/types/edit'

const invokeMock = vi.mocked(invoke)

function makeEdit(over: Partial<Edit>): Edit {
  return {
    id: 'e-1',
    session_id: 's-1',
    tool: 'Edit',
    path: '/abs/proj/file.ts',
    before_blob_sha: 'before-sha',
    after_blob_sha: 'after-sha',
    status: 'pending',
    hook_phase: 'post',
    created_at: new Date().toISOString(),
    decided_at: null,
    explanation_md: null,
    explanation_cached_at: null,
    rollback_of_edit_id: null,
    ...over
  }
}

function renderWithClient(ui: React.ReactNode) {
  // Fresh QueryClient per test so cached invoke responses do not leak.
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

function wire(list: Edit[] | Error) {
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === 'list_edits') return list instanceof Error ? Promise.reject(list) : Promise.resolve(list)
    if (cmd === 'sessions_refresh') return Promise.resolve({ labelled: 0 })
    return Promise.resolve(undefined)
  })
}

let boxSpy: { mockRestore: () => void }
function giveBox() {
  boxSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 320, height: 600, top: 0, left: 0, right: 320, bottom: 600, x: 0, y: 0, toJSON: () => ({})
  })
}

const reads = () => invokeMock.mock.calls.filter((c) => c[0] === 'list_edits').length

describe('<EditListPanel />', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    resetIndexThrottle()
    useReviewFilterStore.setState({ claudeOnly: { pending: false, history: false }, sessionId: null })
    giveBox()
  })
  afterEach(() => {
    boxSpy.mockRestore()
  })

  it('renders only pending edits when showHistory=false', async () => {
    wire([
      makeEdit({ id: 'a', status: 'pending', path: '/proj/a.ts' }),
      makeEdit({ id: 'b', status: 'accepted', path: '/proj/b.ts' }),
      makeEdit({ id: 'c', status: 'pending_decision', path: '/proj/c.ts' })
    ])
    renderWithClient(<EditListPanel selectedId={null} onSelect={() => {}} showHistory={false} />)
    expect(await screen.findByText(/a\.ts/)).toBeInTheDocument()
    expect(screen.getByText(/c\.ts/)).toBeInTheDocument()
    expect(screen.queryByText(/b\.ts/)).not.toBeInTheDocument()
  })

  it('renders only history statuses when showHistory=true', async () => {
    wire([
      makeEdit({ id: 'a', status: 'pending', path: '/proj/a.ts' }),
      makeEdit({ id: 'b', status: 'accepted', path: '/proj/b.ts' }),
      makeEdit({ id: 'd', status: 'rolled_back', path: '/proj/d.ts' })
    ])
    renderWithClient(<EditListPanel selectedId={null} onSelect={() => {}} showHistory={true} />)
    expect(await screen.findByText(/b\.ts/)).toBeInTheDocument()
    expect(screen.getByText(/d\.ts/)).toBeInTheDocument()
    expect(screen.queryByText(/a\.ts/)).not.toBeInTheDocument()
  })

  it('filters by projectPath prefix', async () => {
    wire([makeEdit({ id: 'a', path: '/proj-x/in.ts' }), makeEdit({ id: 'b', path: '/proj-y/out.ts' })])
    renderWithClient(<EditListPanel selectedId={null} onSelect={() => {}} showHistory={false} projectPath="/proj-x" />)
    expect(await screen.findByText(/in\.ts/)).toBeInTheDocument()
    expect(screen.queryByText(/out\.ts/)).not.toBeInTheDocument()
  })

  it('search input narrows visible rows and the status slot reads {v} / {t} mục', async () => {
    wire([makeEdit({ id: 'a', path: '/proj/alpha.ts' }), makeEdit({ id: 'b', path: '/proj/beta.ts' })])
    renderWithClient(<EditListPanel selectedId={null} onSelect={() => {}} showHistory={false} />)
    await screen.findByText(/alpha\.ts/)
    expect(screen.getByText('2 mục')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText(/Tìm path/i), { target: { value: 'beta' } })
    await waitFor(() => expect(screen.queryByText(/alpha\.ts/)).not.toBeInTheDocument())
    expect(screen.getByText(/beta\.ts/)).toBeInTheDocument()
    expect(screen.getByText('1 / 2 mục')).toBeInTheDocument()
  })

  it('shows the "không tìm thấy" empty state when search yields zero results', async () => {
    wire([makeEdit({ id: 'a', path: '/proj/alpha.ts' })])
    renderWithClient(<EditListPanel selectedId={null} onSelect={() => {}} showHistory={false} />)
    await screen.findByText(/alpha\.ts/)
    fireEvent.change(screen.getByPlaceholderText(/Tìm path/i), { target: { value: 'no-match-here' } })
    expect(await screen.findByText('Không tìm thấy')).toBeInTheDocument()
    expect(screen.getByText('Thử từ khoá khác.')).toBeInTheDocument()
  })

  it('an empty Chờ duyệt and an empty Đã xử lý each say so', async () => {
    wire([])
    const first = renderWithClient(<EditListPanel selectedId={null} onSelect={() => {}} />)
    expect(await screen.findByText('Không còn thay đổi nào chờ duyệt')).toBeInTheDocument()
    expect(screen.getByText('Thay đổi Claude tạo ra sẽ hiện ở đây ngay khi xảy ra.')).toBeInTheDocument()
    first.unmount()
    renderWithClient(<EditListPanel selectedId={null} onSelect={() => {}} showHistory />)
    expect(await screen.findByText('Chưa có thay đổi nào đã xử lý')).toBeInTheDocument()
    expect(screen.getByText('Thay đổi đã chấp nhận hoặc từ chối sẽ hiện ở đây.')).toBeInTheDocument()
  })

  it('clicking a row calls onSelect with the edit id', async () => {
    wire([makeEdit({ id: 'click-me', path: '/proj/clickable.ts' })])
    const onSelect = vi.fn()
    renderWithClient(<EditListPanel selectedId={null} onSelect={onSelect} showHistory={false} />)
    fireEvent.click(await screen.findByRole('option', { name: /clickable\.ts/ }))
    expect(onSelect).toHaveBeenCalledWith('click-me')
  })

  it('is a listbox of 72px rows marked as the primary list, and its search box as the primary search', async () => {
    wire([makeEdit({ id: 'a', path: '/proj/alpha.ts' })])
    renderWithClient(<EditListPanel selectedId="a" onSelect={() => {}} />)
    const list = await screen.findByRole('listbox', { name: 'Thay đổi chờ duyệt' })
    expect(list).toHaveAttribute('data-primary-list')
    const option = within(list).getByRole('option')
    expect(option).toHaveAttribute('aria-selected', 'true')
    expect(option.firstElementChild).toHaveClass('h-row-edit')
    expect(screen.getByRole('searchbox', { name: 'Tìm path / tool…' })).toHaveAttribute('data-primary-search')
  })

  it('a row shows the short path, the tool, the status mark and the source on three lines', async () => {
    wire([makeEdit({ id: 'a', path: '/abs/proj/file.ts', tool: 'Write', status: 'pending_decision' })])
    renderWithClient(<EditListPanel selectedId={null} onSelect={() => {}} />)
    const option = await screen.findByRole('option')
    expect(within(option).getByText('proj/file.ts')).toHaveAttribute('title', '/abs/proj/file.ts')
    expect(within(option).getByText(/^Write · /)).toBeInTheDocument()
    expect(within(option).getByText('Chờ quyết định')).toBeInTheDocument()
    expect(within(option).getByText('không rõ / bạn tự sửa')).toBeInTheDocument()
  })

  it('UC-001/AC-18 the Down and Up arrows move the selection to the next and the previous change', async () => {
    wire([makeEdit({ id: 'a', path: '/proj/a.ts' }), makeEdit({ id: 'b', path: '/proj/b.ts' })])
    const onSelect = vi.fn()
    renderWithClient(<EditListPanel selectedId="a" onSelect={onSelect} />)
    const list = await screen.findByRole('listbox')
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(onSelect).toHaveBeenLastCalledWith('b')
  })

  it('UC-001/AC-18 the selection keys wait while a key decision is in flight and work again after', async () => {
    wire([makeEdit({ id: 'a', path: '/proj/a.ts' }), makeEdit({ id: 'b', path: '/proj/b.ts' })])
    const onSelect = vi.fn()
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const panel = (locked: boolean) => (
      <QueryClientProvider client={qc}>
        <EditListPanel selectedId="a" onSelect={onSelect} locked={locked} />
      </QueryClientProvider>
    )
    const { rerender } = render(panel(true))
    const list = await screen.findByRole('listbox')
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(onSelect).not.toHaveBeenCalled()
    rerender(panel(false))
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' })
    expect(onSelect).toHaveBeenCalledWith('b')
  })

  it('renders a window of rows, not all 5000', async () => {
    wire(Array.from({ length: 5000 }, (_, i) => makeEdit({ id: `e-${i}`, path: `/proj/f${i}.ts` })))
    renderWithClient(<EditListPanel selectedId={null} onSelect={() => {}} />)
    await screen.findAllByRole('option')
    expect(screen.getAllByRole('option').length).toBeLessThanOrEqual(40)
    expect(screen.getByText('5000 mục')).toBeInTheDocument()
  })

  it('UC-001/AC-12 one edits-changed refresh makes one list_edits call', async () => {
    wire([makeEdit({ id: 'a', path: '/proj/a.ts' })])
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <EditListPanel selectedId={null} onSelect={() => {}} />
      </QueryClientProvider>
    )
    await screen.findByText(/a\.ts/)
    expect(reads()).toBe(1)
    await qc.invalidateQueries({ queryKey: ['edits'] })
    expect(reads()).toBe(2)
  })

  it('a failing list shows "Không tải được danh sách thay đổi" with Thử lại instead of the empty state, and Thử lại reads again', async () => {
    wire(new Error('boom'))
    renderWithClient(<EditListPanel selectedId={null} onSelect={() => {}} />)
    expect(await screen.findByText('Không tải được danh sách thay đổi')).toBeInTheDocument()
    expect(screen.getByText('boom')).toBeInTheDocument()
    expect(screen.queryByText('Không còn thay đổi nào chờ duyệt')).not.toBeInTheDocument()
    wire([makeEdit({ id: 'a', path: '/proj/back.ts' })])
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }))
    expect(await screen.findByText(/back\.ts/)).toBeInTheDocument()
  })
})

describe('<EditListPanel /> source labels and filters', () => {
  const rows = [
    makeEdit({ id: 'c1', path: '/proj/by-claude.ts', source: 'claude', session_id: 'aaaabbbb-1', decision: 'accept' }),
    makeEdit({ id: 'c2', path: '/proj/other-session.ts', source: 'claude', session_id: 'ccccdddd-2', decision: 'accept' }),
    makeEdit({ id: 'u1', path: '/proj/by-hand.ts', source: 'unknown', session_id: null }),
  ]

  beforeEach(() => {
    invokeMock.mockReset()
    resetIndexThrottle()
    useReviewFilterStore.setState({ claudeOnly: { pending: false, history: false }, sessionId: null })
    giveBox()
  })
  afterEach(() => {
    boxSpy.mockRestore()
  })

  it('UC-001/AC-2 a Claude change shows its session and decision, one the user saved is labelled as the user\'s', async () => {
    wire(rows)
    renderWithClient(<EditListPanel selectedId={null} onSelect={() => {}} />)
    expect(await screen.findByText('Claude · session aaaabbbb')).toBeInTheDocument()
    expect(screen.getAllByText('được phép')).toHaveLength(2)
    expect(screen.getByText('không rõ / bạn tự sửa')).toBeInTheDocument()
  })

  it('the toggle keeps only Claude changes', async () => {
    wire(rows)
    renderWithClient(<EditListPanel selectedId={null} onSelect={() => {}} />)
    await screen.findByText(/by-hand\.ts/)
    const toggle = screen.getByRole('button', { name: 'chỉ thay đổi của Claude' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(toggle)
    await waitFor(() => expect(screen.queryByText(/by-hand\.ts/)).not.toBeInTheDocument())
    expect(screen.getByText(/by-claude\.ts/)).toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
  })

  it('UC-001/AC-3 the Claude filter of Pending leaves History unfiltered', async () => {
    wire(rows.map((r) => ({ ...r, status: 'accepted' as const })))
    useReviewFilterStore.setState({ claudeOnly: { pending: true, history: false } })
    renderWithClient(<EditListPanel selectedId={null} onSelect={() => {}} showHistory />)
    expect(await screen.findByText(/by-hand\.ts/)).toBeInTheDocument()
    expect(screen.getByText(/by-claude\.ts/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'chỉ thay đổi của Claude' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('the session filter shows one session and its chip clears it', async () => {
    wire(rows)
    useReviewFilterStore.setState({ sessionId: 'aaaabbbb-1' })
    renderWithClient(<EditListPanel selectedId={null} onSelect={() => {}} />)
    await screen.findByText(/by-claude\.ts/)
    expect(screen.queryByText(/other-session\.ts/)).not.toBeInTheDocument()
    expect(screen.getByText('session aaaabbbb')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ lọc session' }))
    expect(await screen.findByText(/other-session\.ts/)).toBeInTheDocument()
  })

  it('a filter with no match shows the approved empty state', async () => {
    wire(rows)
    useReviewFilterStore.setState({ sessionId: 'nope' })
    renderWithClient(<EditListPanel selectedId={null} onSelect={() => {}} />)
    expect(await screen.findByText('Không có thay đổi nào khớp bộ lọc')).toBeInTheDocument()
    expect(screen.getByText('Tắt bộ lọc để xem tất cả.')).toBeInTheDocument()
  })

  it('UC-001/AC-12 a filter that hides the selected row clears the selection', async () => {
    wire(rows)
    const onSelect = vi.fn()
    useReviewFilterStore.setState({ claudeOnly: { pending: true, history: false } })
    renderWithClient(<EditListPanel selectedId="u1" onSelect={onSelect} />)
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(null))
  })

  it('UC-001/AC-14 shows the indexing note in the status slot while the session index runs', async () => {
    let done: (v: unknown) => void = () => {}
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'list_edits') return Promise.resolve(rows)
      if (cmd === 'sessions_refresh') return new Promise((r) => { done = r })
      return Promise.resolve(undefined)
    })
    renderWithClient(<EditListPanel selectedId={null} onSelect={() => {}} />)
    const note = await screen.findByText(/Đang lập chỉ mục lịch sử session/)
    expect(note.closest('[role="status"]')?.parentElement).toHaveClass('h-slot')
    done({ labelled: 0 })
    await waitFor(() => expect(screen.queryByText(/Đang lập chỉ mục/)).not.toBeInTheDocument())
  })

  it('UC-001/AC-14 a failed session-history read shows the approved failure line in the status slot', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'list_edits') return Promise.resolve(rows)
      if (cmd === 'sessions_refresh') return Promise.reject(new Error('boom'))
      return Promise.resolve(undefined)
    })
    renderWithClient(<EditListPanel selectedId={null} onSelect={() => {}} />)
    const text = 'Không đọc được lịch sử session: boom — nhãn nguồn có thể chưa đủ. Mở lại tab để thử lại.'
    const line = await screen.findByText(text)
    expect(line).toHaveAttribute('title', text)
    expect(line.closest('[role="alert"]')?.parentElement).toHaveClass('h-slot')
  })

  it('UC-001/AC-14 mounting the panel again after a failure reads the history at once', async () => {
    let fail = true
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'list_edits') return Promise.resolve(rows)
      if (cmd === 'sessions_refresh') return fail ? Promise.reject(new Error('boom')) : Promise.resolve({ labelled: 0 })
      return Promise.resolve(undefined)
    })
    const refreshCalls = () => invokeMock.mock.calls.filter((c) => c[0] === 'sessions_refresh').length
    const first = renderWithClient(<EditListPanel selectedId={null} onSelect={() => {}} />)
    await screen.findByText(/Không đọc được lịch sử session: boom/)
    first.unmount()
    fail = false
    renderWithClient(<EditListPanel selectedId={null} onSelect={() => {}} />)
    await waitFor(() => expect(refreshCalls()).toBe(2))
    await waitFor(() => expect(screen.queryByText(/Không đọc được lịch sử session/)).not.toBeInTheDocument())
  })

  it('two mounts within 15 s of a successful read call sessions_refresh once', async () => {
    wire(rows)
    const refreshCalls = () => invokeMock.mock.calls.filter((c) => c[0] === 'sessions_refresh').length
    const first = renderWithClient(<EditListPanel selectedId={null} onSelect={() => {}} />)
    await screen.findByText(/by-hand\.ts/)
    await waitFor(() => expect(screen.queryByText(/Đang lập chỉ mục/)).not.toBeInTheDocument())
    first.unmount()
    renderWithClient(<EditListPanel selectedId={null} onSelect={() => {}} />)
    await screen.findByText(/by-hand\.ts/)
    expect(refreshCalls()).toBe(1)
  })
})
