import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'
import CleanupPanel from '../CleanupPanel'
import NoticeHost from '@/components/ui/NoticeHost'
import { useNoticeStore } from '@/stores/useNoticeStore'
import type { CleanupScan } from '@/types/session'

vi.mock('focus-trap-react', () => ({ default: ({ children }: { children: React.ReactNode }) => children }))
const invokeMock = vi.mocked(invoke)

const MTIME = 1_700_000_000
const scan = (cutoff: number, aged: number): CleanupScan => ({
  cutoff_days: cutoff,
  groups: {
    redundant: [{ path: '/h/.claude/skills.zip', size: 2048, mtime: MTIME, reason: null }],
    aged: Array.from({ length: aged }, (_, i) => ({ path: `/h/.claude/projects/-p/s${i}.jsonl`, size: 1024, mtime: MTIME, reason: null })),
    never_touch: [{ path: '/h/.claude/settings.json.bak.1', size: 10, mtime: MTIME, reason: 'kept_list' }],
  },
})

function wire(extra: Record<string, unknown> = {}) {
  invokeMock.mockImplementation((cmd: string, args?: unknown) => {
    if (cmd === 'cleanup_scan') {
      const d = (args as { cutoffDays: number }).cutoffDays
      if ('scanError' in extra) return Promise.reject(new Error('disk gone'))
      if ('empty' in extra) return Promise.resolve({ cutoff_days: d, groups: { redundant: [], aged: [], never_touch: [] } })
      return Promise.resolve(scan(d, d === 7 ? 3 : 1))
    }
    if (cmd in extra) return Promise.resolve(extra[cmd])
    return Promise.resolve(undefined)
  })
}

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <NoticeHost />
      <CleanupPanel />
    </QueryClientProvider>
  )
}

const trashButton = () => screen.getByRole('button', { name: 'Chuyển vào Thùng rác' })

describe('<CleanupPanel />', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    useNoticeStore.getState().clear()
  })

  it('UC-005 / AC-1: items show name, size and date in three groups with the pinned titles', async () => {
    wire()
    renderPanel()
    const row = (await screen.findByText('skills.zip')).closest('tr') as HTMLElement
    expect(within(row).getByText('2,0 KB')).toBeInTheDocument()
    expect(within(row).getByText(new Date(MTIME * 1000).toLocaleDateString('vi-VN'))).toBeInTheDocument()
    for (const title of ['Rõ ràng thừa', 'Claude Code tạo ra — dọn theo tuổi', 'Không đụng tới']) {
      expect(screen.getByRole('heading', { level: 2, name: new RegExp(title) })).toBeInTheDocument()
    }
    expect(screen.queryByText(/never touch/)).toBeNull()
  })

  it('the first two groups start open and the protected group starts closed', async () => {
    wire()
    renderPanel()
    await screen.findByText('skills.zip')
    expect(screen.getByRole('button', { name: /Rõ ràng thừa/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /dọn theo tuổi/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /Không đụng tới/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('rows are 36px table rows with a real checkbox', async () => {
    wire()
    renderPanel()
    const row = (await screen.findByText('skills.zip')).closest('tr') as HTMLElement
    expect(row.className).toContain('h-row-cleanup')
    const box = within(row).getByRole('checkbox', { name: 'skills.zip' })
    expect(box.tagName).toBe('INPUT')
    expect(box).toHaveAttribute('type', 'checkbox')
  })

  it('UC-005 / AC-2: a protected row shows a lock and its reason instead of a checkbox', async () => {
    wire()
    renderPanel()
    await screen.findByText('skills.zip')
    fireEvent.click(screen.getByRole('button', { name: /Không đụng tới/ }))
    const row = (await screen.findByText('settings.json.bak.1')).closest('tr') as HTMLElement
    expect(within(row).queryByRole('checkbox')).toBeNull()
    expect(within(row).getByText('Không chọn được')).toBeInTheDocument()
    expect(within(row).getByText('trong danh sách giữ')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /Chọn tất cả trong Không đụng tới/ })).toBeNull()
  })

  it('the cut-off is a Segmented control of 7, 30 and 90 days that opens at 30', async () => {
    wire()
    renderPanel()
    await screen.findByText('skills.zip')
    expect(screen.getByRole('radiogroup', { name: 'Cũ hơn' })).toBeInTheDocument()
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual(['7 ngày', '30 ngày', '90 ngày'])
    expect(screen.getByRole('radio', { name: '30 ngày' })).toHaveAttribute('aria-checked', 'true')
    expect(invokeMock).toHaveBeenCalledWith('cleanup_scan', { cutoffDays: 30 })
  })

  it('UC-005 / AC-5: changing the cut-off rescans and ticks nothing', async () => {
    wire()
    renderPanel()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'skills.zip' }))
    expect(screen.getByText('Đã chọn 1 mục · 2,0 KB')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: '7 ngày' }))
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('cleanup_scan', { cutoffDays: 7 }))
    expect(await screen.findByText('Đã chọn 0 mục · 0 B')).toBeInTheDocument()
    expect(screen.getByText('projects/-p/s2.jsonl')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'projects/-p/s0.jsonl' })).not.toBeChecked()
  })

  it('a group checkbox ticks all of its rows and shows a partial selection as indeterminate', async () => {
    wire()
    renderPanel()
    fireEvent.click(await screen.findByRole('radio', { name: '7 ngày' }))
    const all = await screen.findByRole('checkbox', { name: 'Chọn tất cả trong Claude Code tạo ra — dọn theo tuổi' })
    await screen.findByText('projects/-p/s2.jsonl')
    fireEvent.click(screen.getByRole('checkbox', { name: 'projects/-p/s0.jsonl' }))
    expect((all as HTMLInputElement).indeterminate).toBe(true)
    fireEvent.click(all)
    expect(screen.getAllByRole('checkbox', { checked: true })).toHaveLength(4)
    expect(screen.getByText('Đã chọn 3 mục · 3,0 KB')).toBeInTheDocument()
  })

  it('UC-005 / AC-3: the footer is always there and the button is disabled until something is ticked', async () => {
    wire()
    renderPanel()
    expect(trashButton()).toBeDisabled()
    expect(screen.getByText('Đã chọn 0 mục · 0 B').closest('div')?.className).toContain('h-footer-bar')
    fireEvent.click(await screen.findByRole('checkbox', { name: 'skills.zip' }))
    expect(trashButton()).toBeEnabled()
    expect(invokeMock).not.toHaveBeenCalledWith('cleanup_trash', expect.anything())
  })

  it('UC-005 / AC-4: a ticked archive goes to the Trash only after the confirmation, and cancel moves nothing', async () => {
    wire({ cleanup_trash: [{ path: '/h/.claude/skills.zip', ok: true, gone: false, error: null }] })
    const confirmSpy = vi.spyOn(window, 'confirm')
    renderPanel()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'skills.zip' }))
    fireEvent.click(trashButton())
    const dialog = screen.getByRole('dialog', { name: 'Chuyển 1 mục vào Thùng rác?' })
    expect(within(dialog).getByText('Tổng 2,0 KB. Khôi phục được từ Thùng rác.')).toBeInTheDocument()
    expect(within(dialog).getByText('skills.zip')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hủy' }))
    expect(invokeMock).not.toHaveBeenCalledWith('cleanup_trash', expect.anything())
    fireEvent.click(trashButton())
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Chuyển vào Thùng rác' }))
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('cleanup_trash', { paths: ['/h/.claude/skills.zip'] }))
    expect(await screen.findByText('Đã chuyển 1 mục (2,0 KB) vào Thùng rác')).toBeInTheDocument()
    expect(screen.getByText('Đã chọn 0 mục · 0 B')).toBeInTheDocument()
    expect(confirmSpy).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('a refetch that drops every ticked item closes the confirm for good', async () => {
    wire()
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <NoticeHost />
        <CleanupPanel />
      </QueryClientProvider>
    )
    fireEvent.click(await screen.findByRole('checkbox', { name: 'skills.zip' }))
    fireEvent.click(trashButton())
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    // What a rescan returns once the ticked item is gone.
    const now = scan(30, 1)
    act(() => {
      qc.setQueryData(['cleanup', 30], { ...now, groups: { ...now.groups, redundant: [] } })
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(await screen.findByRole('checkbox', { name: 'projects/-p/s0.jsonl' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(trashButton())
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('UC-005 / E1: one failing item does not stop the others and is listed with its reason in the notice', async () => {
    wire({
      cleanup_trash: [
        { path: '/h/.claude/skills.zip', ok: true, gone: false, error: null },
        { path: '/h/.claude/projects/-p/s0.jsonl', ok: false, gone: false, error: 'locked' },
      ],
    })
    renderPanel()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'skills.zip' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'projects/-p/s0.jsonl' }))
    fireEvent.click(trashButton())
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Chuyển vào Thùng rác' }))
    expect(await screen.findByText(/Đã chuyển 1 mục/)).toBeInTheDocument()
    expect(screen.getByText('1 mục không chuyển được')).toBeInTheDocument()
    expect(screen.getByText('projects/-p/s0.jsonl: locked')).toBeInTheDocument()
  })

  it('UC-005 / E1: a rejected cleanup_trash shows the message inside the dialog and confirm works again', async () => {
    let calls = 0
    invokeMock.mockImplementation((cmd: string, args?: unknown) => {
      if (cmd === 'cleanup_scan') return Promise.resolve(scan((args as { cutoffDays: number }).cutoffDays, 1))
      if (cmd === 'cleanup_trash') {
        calls += 1
        return calls === 1 ? Promise.reject(new Error('boom')) : Promise.resolve([])
      }
      return Promise.resolve(undefined)
    })
    renderPanel()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'skills.zip' }))
    fireEvent.click(trashButton())
    const confirmBtn = () => within(screen.getByRole('dialog')).getByRole('button', { name: 'Chuyển vào Thùng rác' })
    fireEvent.click(confirmBtn())
    expect(await within(screen.getByRole('dialog')).findByText('1 mục không chuyển được')).toBeInTheDocument()
    await waitFor(() => expect(confirmBtn()).not.toBeDisabled())
    fireEvent.click(confirmBtn())
    await waitFor(() => expect(calls).toBe(2))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('UC-005 / E2: a failed scan shows the error with a retry that scans again', async () => {
    let fail = true
    invokeMock.mockImplementation((cmd: string, args?: unknown) => {
      if (cmd === 'cleanup_scan') return fail ? Promise.reject(new Error('disk gone')) : Promise.resolve(scan((args as { cutoffDays: number }).cutoffDays, 1))
      return Promise.resolve(undefined)
    })
    renderPanel()
    expect(await screen.findByText('Lỗi quét ~/.claude.')).toBeInTheDocument()
    expect(screen.getByText('disk gone')).toBeInTheDocument()
    expect(trashButton()).toBeDisabled()
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }))
    expect(await screen.findByText('skills.zip')).toBeInTheDocument()
  })

  it('says so when there is nothing to clean and when a group is empty', async () => {
    wire({ empty: true })
    renderPanel()
    expect(await screen.findByText('Không có gì cần dọn')).toBeInTheDocument()
    expect(screen.getAllByText('Không có mục nào').length).toBeGreaterThanOrEqual(2)
  })

  it('shows what can be cleaned once the scan is in', async () => {
    wire()
    renderPanel()
    expect(screen.getByText('Đang quét ~/.claude…')).toBeInTheDocument()
    expect(await screen.findByText('Có thể dọn 2 mục · 3,0 KB')).toBeInTheDocument()
  })
})
