// ProjectSwitcher: the project menu of the sidebar (UC-002 selecting, adding, removing a project).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Project } from '@/types/edit'

vi.mock('@/lib/ipc', () => ({
  api: { listProjects: vi.fn(), addProject: vi.fn(), removeProject: vi.fn(), touchProject: vi.fn() }
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))

import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { api } from '@/lib/ipc'
import { ConfirmProvider } from '@/components/ui/ConfirmProvider'
import { useNoticeStore } from '@/stores/useNoticeStore'
import { PROJECT_COLORS } from '@/lib/projectColors'
import ProjectSwitcher from '../ProjectSwitcher'

const DEMO = { id: 'p-1', name: 'demo', path: 'D:/code/demo', color: '#10b981' } as Project
const OTHER = { id: 'p-2', name: 'other', path: 'D:/code/other', color: null } as Project

function renderSwitcher(opts: { active?: string | null; rail?: boolean; onSelect?: (id: string | null) => void } = {}) {
  const onSelect = opts.onSelect ?? vi.fn()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <ConfirmProvider>
        <ProjectSwitcher activeProjectId={opts.active ?? null} onSelect={onSelect} rail={opts.rail ?? false} />
      </ConfirmProvider>
    </QueryClientProvider>
  )
  return { onSelect }
}

const trigger = () => screen.getByRole('button', { name: /Project/ })

beforeEach(() => {
  vi.mocked(api.listProjects).mockReset().mockResolvedValue([DEMO, OTHER])
  vi.mocked(api.addProject).mockReset()
  vi.mocked(api.removeProject).mockReset().mockResolvedValue(undefined)
  vi.mocked(api.touchProject).mockReset().mockResolvedValue(undefined)
  vi.mocked(openDialog).mockReset()
  useNoticeStore.getState().clear()
})

describe('ProjectSwitcher', () => {
  it('names the choice on the button: Tất cả, or the project name once the list has loaded', async () => {
    renderSwitcher()
    await waitFor(() => expect(trigger()).toHaveTextContent('Tất cả'))
  })

  it('names the chosen project on the button', async () => {
    renderSwitcher({ active: 'p-1' })
    expect(await screen.findByRole('button', { name: 'Project demo' })).toBeInTheDocument()
  })

  it('lists Tất cả and every project as radio items with the current one checked', async () => {
    const user = userEvent.setup()
    renderSwitcher({ active: 'p-2' })
    await screen.findByRole('button', { name: /other/ })
    await user.click(trigger())
    const menu = screen.getByRole('menu')
    const radios = within(menu).getAllByRole('menuitemradio')
    expect(radios.map((r) => r.textContent)).toEqual([expect.stringContaining('Tất cả'), 'demo', 'other'])
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true'])
  })

  it('selecting a project passes its id and touches it; selecting Tất cả passes null', async () => {
    const user = userEvent.setup()
    const { onSelect } = renderSwitcher({ active: 'p-2' })
    await screen.findByRole('button', { name: /other/ })
    await user.click(trigger())
    await user.click(screen.getByRole('menuitemradio', { name: 'demo' }))
    expect(onSelect).toHaveBeenLastCalledWith('p-1')
    expect(api.touchProject).toHaveBeenCalledWith('p-1')
    await user.click(trigger())
    await user.click(screen.getByRole('menuitemradio', { name: /Tất cả/ }))
    expect(onSelect).toHaveBeenLastCalledWith(null)
  })

  it('adds a project through the folder dialog with a colour from the list and selects it', async () => {
    const user = userEvent.setup()
    vi.mocked(openDialog).mockResolvedValue('D:/code/new')
    vi.mocked(api.addProject).mockResolvedValue({ ...DEMO, id: 'p-3', name: 'new' })
    const { onSelect } = renderSwitcher()
    await user.click(trigger())
    await user.click(screen.getByRole('menuitem', { name: /Thêm project/ }))
    expect(openDialog).toHaveBeenCalledWith({ directory: true, multiple: false, title: 'Chọn folder project để theo dõi' })
    await waitFor(() => expect(api.addProject).toHaveBeenCalled())
    const [path, name, color] = vi.mocked(api.addProject).mock.calls[0]
    expect([path, name]).toEqual(['D:/code/new', undefined])
    expect(PROJECT_COLORS).toContain(color)
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('p-3'))
  })

  it('adds nothing when the folder dialog is cancelled', async () => {
    const user = userEvent.setup()
    vi.mocked(openDialog).mockResolvedValue(null)
    const { onSelect } = renderSwitcher()
    await user.click(trigger())
    await user.click(screen.getByRole('menuitem', { name: /Thêm project/ }))
    await waitFor(() => expect(openDialog).toHaveBeenCalled())
    expect(api.addProject).not.toHaveBeenCalled()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('shows a danger notice when adding fails', async () => {
    const user = userEvent.setup()
    vi.mocked(openDialog).mockResolvedValue('D:/code/new')
    vi.mocked(api.addProject).mockRejectedValue('boom')
    renderSwitcher()
    await user.click(trigger())
    await user.click(screen.getByRole('menuitem', { name: /Thêm project/ }))
    await waitFor(() => expect(useNoticeStore.getState().notices).toHaveLength(1))
    const n = useNoticeStore.getState().notices[0]
    expect(n.tone).toBe('danger')
    expect(n.children).toBe('Không thêm được project: boom')
  })

  it('offers removal only for a chosen project, and removes it only after the in-app confirm', async () => {
    const user = userEvent.setup()
    const { onSelect } = renderSwitcher({ active: 'p-1' })
    await screen.findByRole('button', { name: /demo/ })
    await user.click(trigger())
    await user.click(screen.getByRole('menuitem', { name: 'Bỏ theo dõi project "demo"…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Bỏ theo dõi project "demo"?' })
    expect(within(dialog).getByText('Các thay đổi đã ghi nhận vẫn được giữ.')).toBeInTheDocument()
    expect(api.removeProject).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Hủy' }))
    expect(api.removeProject).not.toHaveBeenCalled()

    await user.click(trigger())
    await user.click(screen.getByRole('menuitem', { name: 'Bỏ theo dõi project "demo"…' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Bỏ theo dõi' }))
    await waitFor(() => expect(api.removeProject).toHaveBeenCalledWith('p-1'))
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(null))
  })

  it('does not offer removal on Tất cả', async () => {
    const user = userEvent.setup()
    renderSwitcher()
    await user.click(trigger())
    expect(screen.queryByRole('menuitem', { name: /Bỏ theo dõi/ })).toBeNull()
  })

  it('shows a danger notice when removing fails and keeps the selection', async () => {
    const user = userEvent.setup()
    vi.mocked(api.removeProject).mockRejectedValue(new Error('locked'))
    const { onSelect } = renderSwitcher({ active: 'p-1' })
    await screen.findByRole('button', { name: /demo/ })
    await user.click(trigger())
    await user.click(screen.getByRole('menuitem', { name: /Bỏ theo dõi/ }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Bỏ theo dõi' }))
    await waitFor(() => expect(useNoticeStore.getState().notices[0]?.children).toBe('Không bỏ theo dõi được project: locked'))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('shows Không tải được project and a retry item when the list fails', async () => {
    const user = userEvent.setup()
    vi.mocked(api.listProjects).mockRejectedValueOnce(new Error('down')).mockResolvedValue([DEMO])
    renderSwitcher()
    expect(await screen.findByText('Không tải được project')).toBeInTheDocument()
    await user.click(trigger())
    await user.click(screen.getByRole('menuitem', { name: /Thử lại/ }))
    await waitFor(() => expect(api.listProjects).toHaveBeenCalledTimes(2))
  })

  it('in the rail the button is a square that still carries the project name', async () => {
    renderSwitcher({ rail: true, active: 'p-1' })
    const btn = await screen.findByRole('button', { name: /demo/ })
    expect(btn).toHaveClass('size-10')
  })
})
