import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import SessionsPage from './SessionsPage'
import NoticeHost from '@/components/ui/NoticeHost'
import { useNoticeStore } from '@/stores/useNoticeStore'
import { useReviewFilterStore } from '@/stores/useReviewFilterStore'
import type { SessionSummary } from '@/types/session'

vi.mock('focus-trap-react', () => ({ default: ({ children }: { children: React.ReactNode }) => children }))
const invokeMock = vi.mocked(invoke)
const listenMock = vi.mocked(listen)

const S1 = {
  id: 'a1b2c3d4-0000', project_dir: '/home/dev/my code/demo', project_folder: '-home-dev-my-code-demo',
  size: 12_400_000, created: 1_790_000_000, modified: 1_790_007_000, change_count: 3, reject_count: 1,
  prompt: 'SECRET-PROMPT-TEXT',
} as SessionSummary
const S2 = { ...S1, id: 'ffff0000-1111', change_count: 0, reject_count: 0, prompt: undefined } as unknown as SessionSummary
const IDLE = { files_total: 2, files_read: 0, bytes_read: 0, malformed_lines: 0, labelled: 0 }

function wire(over: Record<string, unknown> = {}) {
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd in over) return Promise.resolve(over[cmd])
    if (cmd === 'sessions_list') return Promise.resolve([S1, S2])
    if (cmd === 'sessions_refresh') return Promise.resolve(IDLE)
    if (cmd === 'list_edits') return Promise.resolve([{ id: 'e', session_id: 'a1b2c3d4-0000', status: 'pending', path: '/x', tool: 'Edit' }])
    return Promise.resolve(undefined)
  })
}

function renderPage(onNavigate = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <NoticeHost />
      <SessionsPage onNavigate={onNavigate} />
    </QueryClientProvider>
  )
  return onNavigate
}

/** The list item that holds the session with this short id. */
const rowOf = (shortId: string) => screen.getByText(shortId).closest('[role="listitem"]') as HTMLElement

// The virtual list needs a pixel height; jsdom has none, so every element gets a 900 x 600 box.
const realRect = HTMLElement.prototype.getBoundingClientRect

describe('<SessionsPage />', () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  beforeEach(() => {
    invokeMock.mockReset()
    listenMock.mockReset()
    listenMock.mockResolvedValue(() => {})
    writeText.mockClear()
    useNoticeStore.getState().clear()
    HTMLElement.prototype.getBoundingClientRect = () => ({ width: 900, height: 600, top: 0, left: 0, right: 900, bottom: 600, x: 0, y: 0, toJSON: () => ({}) })
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    useReviewFilterStore.setState({ claudeOnly: { pending: false, history: false }, sessionId: null })
  })
  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = realRect
    vi.useRealTimers()
  })

  it('has no inner Sessions / Dọn dẹp tabs', async () => {
    wire()
    renderPage()
    await screen.findByText('a1b2c3d4')
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.queryByText('Dọn dẹp')).toBeNull()
  })

  it('UC-004 / AC-1: lists sessions in one list grouped by project with counts and size', async () => {
    wire()
    renderPage()
    expect(await screen.findByText('a1b2c3d4')).toBeInTheDocument()
    expect(screen.getAllByRole('list')).toHaveLength(1)
    const row = rowOf('a1b2c3d4')
    expect(within(row).getByText('3 thay đổi')).toBeInTheDocument()
    expect(within(row).getByText('1 từ chối')).toBeInTheDocument()
    const group = screen.getByText('/home/dev/my code/demo').closest('[role="listitem"]') as HTMLElement
    expect(within(group).getByText('2 session · 23,7 MB')).toBeInTheDocument()
  })

  it('the sessions are a list of rows with real buttons, with no option and no selection', async () => {
    wire()
    renderPage()
    await screen.findByText('a1b2c3d4')
    expect(screen.getByRole('list', { name: 'Sessions theo project' })).toBeInTheDocument()
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    const group = screen.getByText('/home/dev/my code/demo').closest('[role="listitem"]') as HTMLElement
    expect(within(group).getByRole('heading', { level: 2 })).toBeInTheDocument()
    expect(group).not.toHaveAttribute('aria-selected')
    const row = rowOf('a1b2c3d4')
    expect(row).not.toHaveAttribute('aria-selected')
    for (const name of ['Xem thay đổi', 'Chép lệnh resume', 'Chuyển vào Thùng rác']) {
      expect(within(row).getByRole('button', { name })).toBeInTheDocument()
    }
  })

  it('UC-004 / AC-2: never renders conversation text', async () => {
    wire()
    renderPage()
    await screen.findByText('a1b2c3d4')
    expect(document.body.textContent).not.toContain('SECRET-PROMPT-TEXT')
  })

  it('renders only a window of a long list', async () => {
    const many = Array.from({ length: 300 }, (_, i) => ({ ...S1, id: `id${String(i).padStart(6, '0')}-x`, project_dir: `/home/dev/p${i % 3}` }))
    wire({ sessions_list: many })
    renderPage()
    await screen.findByText('id000000')
    expect(screen.getAllByRole('listitem').length).toBeLessThan(40)
    expect(screen.getAllByRole('listitem')[0]).toHaveAttribute('aria-setsize', '303')
  })

  it('UC-004 / AC-3: Xem thay đổi sets the filter and asks to open Pending when the session has a pending change', async () => {
    wire()
    const nav = renderPage()
    await screen.findByText('a1b2c3d4')
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('list_edits', expect.anything()))
    fireEvent.click(within(rowOf('a1b2c3d4')).getByRole('button', { name: 'Xem thay đổi' }))
    expect(useReviewFilterStore.getState().sessionId).toBe('a1b2c3d4-0000')
    expect(nav).toHaveBeenCalledWith('a1b2c3d4-0000', true)
  })

  it('Xem thay đổi is disabled with no change', async () => {
    wire()
    renderPage()
    await screen.findByText('ffff0000')
    expect(within(rowOf('ffff0000')).getByRole('button', { name: 'Xem thay đổi' })).toBeDisabled()
  })

  it('UC-004 / AC-4: a registered project uses the cd form with its own path', async () => {
    wire()
    renderPage()
    await screen.findByText('a1b2c3d4')
    const row = rowOf('a1b2c3d4')
    expect(within(row).queryByText(/Không rõ thư mục project/)).toBeNull()
    fireEvent.click(within(row).getByRole('button', { name: 'Chép lệnh resume' }))
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('cd "/home/dev/my code/demo" && claude --resume a1b2c3d4-0000')
    )
    expect(await within(row).findByRole('button', { name: 'Đã chép' })).toBeInTheDocument()
  })

  it('UC-004 / AC-4: an unregistered project copies the no-cd form and shows the note in a taller row', async () => {
    // both "/" and "." are encoded as "-" in the folder name, so it cannot be decoded back
    const U = { ...S1, id: 'cccc1111-2222', project_dir: null, project_folder: '-home-dev-code-demo-app' } as unknown as SessionSummary
    wire({ sessions_list: [U] })
    renderPage()
    await screen.findByText('cccc1111')
    const row = rowOf('cccc1111')
    expect(row).toHaveStyle({ height: '84px' })
    expect(within(row).getByText('Không rõ thư mục project — cd vào đúng thư mục trước khi chạy.')).toBeInTheDocument()
    fireEvent.click(within(row).getByRole('button', { name: 'Chép lệnh resume' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('claude --resume cccc1111-2222'))
    expect(screen.getByText('-home-dev-code-demo-app')).toBeInTheDocument()
  })

  it('group rows are 36px and session rows 64px', async () => {
    wire()
    renderPage()
    await screen.findByText('a1b2c3d4')
    const options = screen.getAllByRole('listitem')
    expect(options[0]).toHaveStyle({ height: '36px' })
    expect(options[1]).toHaveStyle({ height: '64px' })
  })

  it('UC-004 / AC-5: cancel keeps the session, confirm trashes it', async () => {
    wire({ session_trash: [{ path: '/h/.claude/projects/-p/a1b2c3d4-0000.jsonl', ok: true, gone: false, error: null }] })
    renderPage()
    await screen.findByText('a1b2c3d4')
    fireEvent.click(within(rowOf('a1b2c3d4')).getByRole('button', { name: /Chuyển vào Thùng rác/ }))
    const dialog = screen.getByRole('dialog', { name: 'Chuyển session vào Thùng rác?' })
    expect(within(dialog).getByText('Sau khi chuyển, lệnh resume của session này không còn dùng được.')).toBeInTheDocument()
    expect(within(dialog).getByText('a1b2c3d4 · /home/dev/my code/demo')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hủy' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(invokeMock).not.toHaveBeenCalledWith('session_trash', expect.anything())
    fireEvent.click(within(rowOf('a1b2c3d4')).getByRole('button', { name: /Chuyển vào Thùng rác/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Chuyển vào Thùng rác' }))
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('session_trash', { id: 'a1b2c3d4-0000' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('UC-004 / E1: a rejected session_trash shows the message inside the dialog and confirm works again', async () => {
    let calls = 0
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'session_trash') {
        calls += 1
        return calls === 1 ? Promise.reject(new Error('boom')) : Promise.resolve([])
      }
      if (cmd === 'sessions_list') return Promise.resolve([S1])
      if (cmd === 'sessions_refresh') return Promise.resolve(IDLE)
      return Promise.resolve([])
    })
    renderPage()
    await screen.findByText('a1b2c3d4')
    fireEvent.click(within(rowOf('a1b2c3d4')).getByRole('button', { name: /Chuyển vào Thùng rác/ }))
    const confirmBtn = () => within(screen.getByRole('dialog')).getByRole('button', { name: 'Chuyển vào Thùng rác' })
    fireEvent.click(confirmBtn())
    expect(await within(screen.getByRole('dialog')).findByText('1 mục không chuyển được')).toBeInTheDocument()
    await waitFor(() => expect(confirmBtn()).not.toBeDisabled())
    fireEvent.click(confirmBtn())
    await waitFor(() => expect(calls).toBe(2))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('UC-004 / E1: a path that could not be moved is listed in a notice with its reason', async () => {
    wire({ session_trash: [{ path: '/h/.claude/projects/-p/a1b2c3d4-0000.jsonl', ok: false, gone: false, error: 'locked' }] })
    renderPage()
    await screen.findByText('a1b2c3d4')
    fireEvent.click(within(rowOf('a1b2c3d4')).getByRole('button', { name: /Chuyển vào Thùng rác/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Chuyển vào Thùng rác' }))
    expect(await screen.findByText('1 mục không chuyển được')).toBeInTheDocument()
    expect(screen.getByText('/h/.claude/projects/-p/a1b2c3d4-0000.jsonl: locked')).toBeInTheDocument()
  })

  it('a load failure shows Lỗi tải sessions. with a retry that loads again', async () => {
    let fail = true
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'sessions_list') return fail ? Promise.reject(new Error('disk gone')) : Promise.resolve([S1])
      if (cmd === 'sessions_refresh') return Promise.resolve(IDLE)
      return Promise.resolve([])
    })
    renderPage()
    expect(await screen.findByText('Lỗi tải sessions.')).toBeInTheDocument()
    expect(screen.getByText('disk gone')).toBeInTheDocument()
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }))
    expect(await screen.findByText('a1b2c3d4')).toBeInTheDocument()
  })

  it('shows an empty state with no sessions', async () => {
    wire({ sessions_list: [] })
    renderPage()
    expect(await screen.findByText('Chưa có session nào.')).toBeInTheDocument()
  })

  it('UC-004 / E2: shows the skipped-lines note in the status slot', async () => {
    wire({ sessions_refresh: { ...IDLE, malformed_lines: 3 } })
    renderPage()
    expect(await screen.findByText('Bỏ qua 3 dòng không đọc được')).toBeInTheDocument()
  })

  it('index progress shows in the status slot as a progress bar and goes away when the pass ends', async () => {
    let push: (p: { done: number; total: number }) => void = () => {}
    listenMock.mockImplementation(((_: string, h: (e: { payload: { done: number; total: number } }) => void) => {
      push = (payload) => h({ payload })
      return Promise.resolve(() => {})
    }) as unknown as typeof listen)
    wire()
    renderPage()
    await screen.findByText('a1b2c3d4')
    act(() => push({ done: 1024 ** 3, total: 4 * 1024 ** 3 }))
    expect(screen.getByText(/Đang lập chỉ mục lịch sử session… 25%/)).toBeInTheDocument()
    expect(screen.getByText('1,00 / 4,00 GB')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Đang lập chỉ mục lịch sử session' })).toHaveAttribute('aria-valuenow', '25')
  })
})
