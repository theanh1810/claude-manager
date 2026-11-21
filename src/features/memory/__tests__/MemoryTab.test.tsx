import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'
import MemoryTab from '../MemoryTab'
import type { MemoryList } from '@/types/memory'

const invokeMock = vi.mocked(invoke)

const LIST: MemoryList = {
  entries: [
    { id: 'f1', kind: 'memory', project: 'demo', source: { path: '/p/.claude/MEMORY.md', line: 6 }, text: '- deploy with pnpm' },
    { id: 'f2', kind: 'error', project: 'demo', source: { path: '/p/docs/plan/x/errors.yaml', line: 18 }, text: '- source: reviewer\n  text: flaky test' },
    { id: 'm1', kind: 'memory', project: null, source: { mem0_id: '9f3c', entity: 'user u1' }, text: 'remember X' },
  ],
  mem0: { state: 'available' },
  problems: [],
}

function wire(list: MemoryList | Error) {
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === 'memory_list') return list instanceof Error ? Promise.reject(list) : Promise.resolve(list)
    return Promise.resolve(undefined)
  })
}

function renderTab(project: string | null = null, onOpenSettings?: () => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryTab project={project} onOpenSettings={onOpenSettings} />
    </QueryClientProvider>
  )
}

// The virtual list needs a pixel height; jsdom has none, so every element gets a 320 x 600 box.
const realRect = HTMLElement.prototype.getBoundingClientRect

describe('<MemoryTab />', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    HTMLElement.prototype.getBoundingClientRect = () => ({ width: 320, height: 600, top: 0, left: 0, right: 320, bottom: 600, x: 0, y: 0, toJSON: () => ({}) })
  })
  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = realRect
  })

  it('lists entries of every source with their source line', async () => {
    wire(LIST)
    renderTab()
    expect(await screen.findByText('/p/.claude/MEMORY.md:6')).toBeInTheDocument()
    expect(screen.getByText('/p/docs/plan/x/errors.yaml:18')).toBeInTheDocument()
    expect(screen.getByText('mem0 · 9f3c')).toBeInTheDocument()
    expect(screen.getByText('3 mục')).toBeInTheDocument()
  })

  it('narrows by kind and by search, with an empty state', async () => {
    wire(LIST)
    renderTab()
    await screen.findByText('3 mục')
    fireEvent.click(screen.getByRole('radio', { name: 'Lỗi' }))
    expect(screen.getByText('1 mục')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Tất cả' }))
    fireEvent.change(screen.getByPlaceholderText('Tìm trong memory và lỗi…'), { target: { value: 'pnpm' } })
    expect(screen.getByText('1 mục')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Tìm trong memory và lỗi…'), { target: { value: 'zzz' } })
    expect(screen.getByText('Không tìm thấy')).toBeInTheDocument()
  })

  it('shows each approved reason sentence and keeps local entries', async () => {
    const cases: [MemoryList['mem0'], string][] = [
      [{ state: 'unavailable', reason: 'no_key', status: null }, 'Chưa nhập mem0 API key — mở Cài đặt để nhập.'],
      [{ state: 'unavailable', reason: 'connection', status: null }, 'Không kết nối được tới mem0. Kiểm tra mạng rồi mở lại màn này.'],
      [{ state: 'unavailable', reason: 'timeout', status: null }, 'mem0 không trả lời sau 15 giây.'],
      [{ state: 'unavailable', reason: 'auth_401_403', status: 403 }, 'mem0 từ chối key (mã 403). Kiểm tra lại key trong Cài đặt.'],
      [{ state: 'unavailable', reason: 'http_other', status: 500 }, 'mem0 báo lỗi (mã 500).'],
      [{ state: 'unavailable', reason: 'bad_reply', status: null }, 'mem0 trả về dữ liệu không đọc được.'],
    ]
    for (const [mem0, text] of cases) {
      wire({ ...LIST, mem0 })
      const { unmount } = renderTab()
      expect(await screen.findByText(new RegExp(`mem0 không khả dụng: ${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))).toBeInTheDocument()
      expect(screen.getByText('/p/.claude/MEMORY.md:6')).toBeInTheDocument()
      unmount()
    }
  })

  it('opens the settings from the no-key banner', async () => {
    wire({ ...LIST, mem0: { state: 'unavailable', reason: 'no_key', status: null } })
    const open = vi.fn()
    renderTab(null, open)
    fireEvent.click(await screen.findByRole('button', { name: 'Cài đặt' }))
    expect(open).toHaveBeenCalled()
  })

  it('asks for one project and shows the scope note', async () => {
    wire({ ...LIST, entries: LIST.entries.slice(0, 2) })
    renderTab('/p')
    await screen.findByText('2 mục')
    expect(invokeMock).toHaveBeenCalledWith('memory_list', { project: '/p' })
    expect(screen.getByText(/chỉ hiện ở “Tất cả”/)).toBeInTheDocument()
    expect(screen.queryByText('mem0 · 9f3c')).not.toBeInTheDocument()
  })

  it('opens the source file and offers no edit or delete control', async () => {
    wire(LIST)
    renderTab()
    fireEvent.click(await screen.findByText('/p/.claude/MEMORY.md:6'))
    fireEvent.click(await screen.findByRole('button', { name: /Mở file/ }))
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('memory_open_file', { path: '/p/.claude/MEMORY.md' }))
    expect(screen.queryByRole('button', { name: /sửa|xoá|xóa|lưu|edit|delete|save/i })).not.toBeInTheDocument()
  })

  it('a mem0 entry has no Mở file button', async () => {
    wire(LIST)
    renderTab()
    fireEvent.click(await screen.findByText('mem0 · 9f3c'))
    expect(screen.queryByRole('button', { name: /Mở file/ })).not.toBeInTheDocument()
  })

  it('shows the error state when the list cannot load, and Thử lại reads it again', async () => {
    wire(new Error('boom'))
    renderTab()
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Lỗi tải memory.')).toBeInTheDocument()
    expect(within(alert).getByText(/boom/)).toBeInTheDocument()
    expect(screen.queryByText(/reload/)).not.toBeInTheDocument()
    wire(LIST)
    fireEvent.click(within(alert).getByRole('button', { name: 'Thử lại' }))
    expect(await screen.findByText('3 mục')).toBeInTheDocument()
    expect(invokeMock.mock.calls.filter(([c]) => c === 'memory_list')).toHaveLength(2)
  })

  it('shows a row for each unreadable file and keeps the other entries', async () => {
    wire({ ...LIST, problems: [{ path: '/p/docs/plan/x/errors.yaml', error: 'bad yaml at line 3' }] })
    renderTab()
    expect(await screen.findByText('Không đọc được: bad yaml at line 3')).toBeInTheDocument()
    expect(screen.getByText('/p/docs/plan/x/errors.yaml')).toBeInTheDocument()
    expect(screen.getByText('/p/.claude/MEMORY.md:6')).toBeInTheDocument()
    expect(screen.getByText('3 mục')).toBeInTheDocument()
  })

  it('UC-002/AC-7 the problem row stays first, is not an option and the arrow keys skip it', async () => {
    wire({ ...LIST, problems: [{ path: '/p/docs/plan/x/errors.yaml', error: 'bad yaml at line 3' }] })
    renderTab()
    const problem = await screen.findByText('Không đọc được: bad yaml at line 3')
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(3)
    expect(options.every((o) => !o.contains(problem))).toBe(true)
    expect(problem.compareDocumentPosition(options[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const listbox = screen.getByRole('listbox')
    fireEvent.keyDown(listbox, { key: 'ArrowDown' })
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('UC-002/AC-1 entries of mem0 come after the local ones, so rows do not jump when mem0 answers late', async () => {
    wire({ ...LIST, entries: [LIST.entries[2], LIST.entries[0], LIST.entries[1]] })
    renderTab()
    await screen.findByText('3 mục')
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      expect.stringContaining('MEMORY.md:6'),
      expect.stringContaining('errors.yaml:18'),
      expect.stringContaining('mem0 · 9f3c'),
    ])
  })

  it('the list pane is the 320px pane, the detail shrinks with min-w-0 and the keys find the list and the search', async () => {
    wire(LIST)
    const { container } = renderTab()
    await screen.findByText('3 mục')
    expect(container.querySelector('.w-pane')).toHaveClass('w-pane', 'shrink-0', 'border-r', 'border-line', 'select-none')
    expect(container.querySelectorAll('aside:not([aria-label]):not([aria-labelledby])')).toHaveLength(0)
    expect(container.querySelector('section')).toHaveClass('min-w-0', 'flex-1')
    expect(container.firstElementChild).toHaveClass('min-w-0')
    expect(container.querySelector('[data-primary-list]')).not.toBeNull()
    expect(screen.getByRole('searchbox', { name: 'Tìm trong memory và lỗi…' })).toHaveAttribute('data-primary-search')
  })

  it('the kind filter reads Tất cả, Memory and Lỗi', async () => {
    wire(LIST)
    renderTab()
    await screen.findByText('3 mục')
    const group = screen.getByRole('radiogroup', { name: 'Loại' })
    expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Tất cả', 'Memory', 'Lỗi'])
    expect(screen.queryByRole('radio', { name: 'Error' })).not.toBeInTheDocument()
  })

  it('a row is a 56px option with the kind mark, the first line and the source; the selected one is not a toggle', async () => {
    wire(LIST)
    renderTab()
    const row = (await screen.findByText('/p/.claude/MEMORY.md:6')).closest('[role="option"]') as HTMLElement
    expect(within(row).getByText('Memory')).toBeInTheDocument()
    expect(within(row).getByText('- deploy with pnpm')).toBeInTheDocument()
    expect(within(row).getByText('demo')).toBeInTheDocument()
    expect(row.firstElementChild).toHaveClass('h-row-memory')
    fireEvent.click(row)
    expect(row).toHaveAttribute('aria-selected', 'true')
    expect(row.querySelector('[data-selected-bar]')).not.toBeNull()
    expect(row.querySelector('button')).toBeNull()
  })

  it('the mem0 reason sits in the 56px slot, cut at three lines with the whole text in its title', async () => {
    wire({ ...LIST, mem0: { state: 'unavailable', reason: 'no_key', status: null } })
    const { container } = renderTab()
    const text = await screen.findByText('mem0 không khả dụng: Chưa nhập mem0 API key — mở Cài đặt để nhập.')
    expect(text).toHaveClass('line-clamp-3')
    expect(text).toHaveAttribute('title', 'mem0 không khả dụng: Chưa nhập mem0 API key — mở Cài đặt để nhập.')
    expect(text.closest('.h-slot')).not.toBeNull()
    expect(container.querySelector('.h-slot [role="status"]')).not.toBeNull()
  })

  it('the count sits in the slot when nothing else needs it, with the scope note under it', async () => {
    wire({ ...LIST, entries: LIST.entries.slice(0, 2) })
    const { container } = renderTab('/p')
    const count = await screen.findByText('2 mục')
    expect(count).toHaveClass('tabular-nums', 'text-xs', 'text-ink-muted')
    expect(count.closest('.h-slot')).not.toBeNull()
    expect(container.querySelector('.h-slot')).toHaveTextContent('mem0 và memory toàn cục chỉ hiện ở “Tất cả”.')
  })

  it('while the list loads in Tất cả the slot says "Đang tải mem0…" as a status', async () => {
    invokeMock.mockImplementation(() => new Promise(() => {}))
    renderTab()
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Đang tải mem0…')
    expect(status.closest('.h-slot')).not.toBeNull()
  })

  it('the detail shows the kind, the project, the source and Mở file, and its markdown starts at level 2', async () => {
    wire({ ...LIST, entries: [{ ...LIST.entries[0], text: '# Ghi chú\n\nnội dung' }, ...LIST.entries.slice(1)] })
    const { container } = renderTab()
    fireEvent.click(await screen.findByText('/p/.claude/MEMORY.md:6'))
    const header = container.querySelector('section header') as HTMLElement
    expect(header).toHaveClass('h-16', 'bg-surface-1', 'border-b', 'border-line')
    expect(within(header).getByText('Memory')).toBeInTheDocument()
    expect(within(header).getByText('· demo')).toBeInTheDocument()
    expect(within(header).getByText('/p/.claude/MEMORY.md:6')).toHaveAttribute('title', '/p/.claude/MEMORY.md:6')
    expect(within(header).getByRole('button', { name: /Mở file/ })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { level: 2, name: 'Ghi chú' })).toBeInTheDocument()
  })

  it('with nothing selected the detail is an empty state', async () => {
    wire(LIST)
    const { container } = renderTab()
    await screen.findByText('3 mục')
    expect(within(container.querySelector('section') as HTMLElement).getByText('Chọn một mục để xem chi tiết')).toBeInTheDocument()
  })

  it('shows no problem row when every file was read', async () => {
    wire(LIST)
    renderTab()
    await screen.findByText('3 mục')
    expect(screen.queryByText(/Không đọc được/)).not.toBeInTheDocument()
  })

  it('keeps the problem row when the kind filter or the search hides every entry', async () => {
    wire({ ...LIST, problems: [{ path: '/p/.claude/MEMORY.md', error: 'permission denied' }] })
    renderTab()
    await screen.findByText('Không đọc được: permission denied')
    fireEvent.click(screen.getByRole('radio', { name: 'Lỗi' }))
    expect(screen.getByText('Không đọc được: permission denied')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Tìm trong memory và lỗi…'), { target: { value: 'zzz' } })
    expect(screen.getByText('Không đọc được: permission denied')).toBeInTheDocument()
  })

  it('shows the empty state with no entries', async () => {
    wire({ entries: [], mem0: { state: 'available' }, problems: [] })
    renderTab()
    expect(await screen.findByText('Chưa có memory hay lỗi nào')).toBeInTheDocument()
  })
})
