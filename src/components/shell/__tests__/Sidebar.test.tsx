// Sidebar: three groups of nav items, the pause and learning switches, the rail and the overlay.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

vi.mock('@/lib/ipc', () => ({
  api: {
    getSettings: vi.fn(),
    togglePause: vi.fn(),
    settingsLearningToggle: vi.fn(),
    listProjects: vi.fn()
  }
}))

import { api } from '@/lib/ipc'
import { ConfirmProvider } from '@/components/ui/ConfirmProvider'
import { useLearningStore } from '@/stores/useLearningStore'
import { useLearningSync } from '@/hooks/useLearningToggle'
import type { NavCounts } from '@/hooks/useNavCounts'
import Sidebar, { useSidebarMode } from '../Sidebar'

const SETTINGS = {
  paused: false, retention_days: 30, anthropic_api_key: '', mem0_api_key: null,
  explain_model: 'claude-opus-5-5', autostart: false, learning: false
}
const READY: NavCounts = { status: 'ready', pending: 3, history: 1200, pendingEdits: [], historyEdits: [] }

function makeStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size }
  }
}

interface Over {
  mode?: 'full' | 'rail' | 'overlay'
  counts?: NavCounts
  screen?: 'edits' | 'history' | 'plans' | 'memory' | 'sessions' | 'cleanup'
}

function renderSidebar(over: Over = {}) {
  const h = {
    onSelectScreen: vi.fn(), onSelectProject: vi.fn(), onOpenSettings: vi.fn(), onToggle: vi.fn(), onCloseOverlay: vi.fn()
  }
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const utils = render(
    <QueryClientProvider client={qc}>
      <ConfirmProvider>
        <Sidebar
          mode={over.mode ?? 'full'}
          screen={over.screen ?? 'edits'}
          counts={over.counts ?? READY}
          activeProjectId={null}
          {...h}
        />
      </ConfirmProvider>
    </QueryClientProvider>
  )
  return { ...utils, ...h }
}

beforeEach(() => {
  vi.mocked(api.getSettings).mockReset().mockResolvedValue({ ...SETTINGS })
  vi.mocked(api.togglePause).mockReset().mockResolvedValue(true)
  vi.mocked(api.settingsLearningToggle).mockReset().mockResolvedValue(true)
  vi.mocked(api.listProjects).mockReset().mockResolvedValue([])
  vi.stubGlobal('localStorage', makeStorage())
  useLearningStore.setState({ enabled: false })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Sidebar navigation', () => {
  it('shows the six items in three groups and marks the active one aria-current page', () => {
    renderSidebar({ screen: 'plans' })
    const nav = screen.getByRole('navigation', { name: 'Điều hướng chính' })
    const groups = within(nav).getAllByRole('group')
    expect(groups.map((g) => g.getAttribute('aria-labelledby')).every(Boolean)).toBe(true)
    expect(groups.map((g) => within(g).getAllByRole('button').length)).toEqual([2, 2, 2])
    expect(within(nav).getAllByRole('button').map((b) => b.textContent?.replace(/[\d.+]+$|,.*$/, '').trim())).toEqual([
      'Chờ duyệt', 'Đã xử lý', 'Plans', 'Memory & lỗi', 'Sessions', 'Dọn dẹp'
    ])
    const current = within(nav).getAllByRole('button').filter((b) => b.getAttribute('aria-current') === 'page')
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveTextContent('Plans')
  })

  it('selecting an item reports its screen', async () => {
    const user = userEvent.setup()
    const { onSelectScreen } = renderSidebar()
    await user.click(screen.getByRole('button', { name: /^Dọn dẹp/ }))
    expect(onSelectScreen).toHaveBeenCalledWith('cleanup')
  })

  it('UC-001/AC-1: counts the pending changes in the name of Chờ duyệt and caps the handled count at 999+', () => {
    renderSidebar()
    expect(screen.getByRole('button', { name: 'Chờ duyệt, 3 thay đổi' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Đã xử lý/ })).toHaveTextContent('999+')
  })

  it('shows a dash with the load error title when the count failed, and nothing while loading', () => {
    const { unmount } = renderSidebar({ counts: { ...READY, status: 'error', pending: null, history: null } })
    expect(screen.getAllByTitle('Không tải được số lượng')).toHaveLength(2)
    expect(screen.getByRole('button', { name: /^Chờ duyệt/ })).toHaveTextContent('—')
    unmount()
    renderSidebar({ counts: { ...READY, status: 'loading', pending: null, history: null } })
    expect(screen.getByRole('button', { name: 'Chờ duyệt' })).toBeInTheDocument()
  })

  it('in the rail the labels stay as accessible names and the counts cap at 99+', () => {
    renderSidebar({ mode: 'rail', counts: { ...READY, pending: 250 } })
    expect(screen.getByRole('button', { name: 'Chờ duyệt, 250 thay đổi' })).toHaveTextContent('99+')
    expect(screen.getByRole('button', { name: /^Plans/ })).toHaveClass('size-10')
  })
})

describe('Sidebar switches', () => {
  it('AC-8: the switch Tạm dừng ghi nhận toggles pause and shows its state line', async () => {
    const user = userEvent.setup()
    vi.mocked(api.getSettings).mockResolvedValue({ ...SETTINGS })
    renderSidebar()
    const sw = await screen.findByRole('switch', { name: 'Tạm dừng ghi nhận' })
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'false'))
    expect(sw).toHaveTextContent('Đang ghi nhận')
    vi.mocked(api.getSettings).mockResolvedValue({ ...SETTINGS, paused: true })
    await user.click(sw)
    expect(api.togglePause).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'true'))
    expect(sw).toHaveTextContent('Đã tạm dừng — không ghi thay đổi mới')
  })

  it('the pause and learning rows are 52px tall', async () => {
    vi.mocked(api.getSettings).mockResolvedValue({ ...SETTINGS })
    renderSidebar()
    for (const name of ['Tạm dừng ghi nhận', 'Chế độ học']) {
      const row = (await screen.findByRole('switch', { name })).parentElement as HTMLElement
      expect(row).toHaveClass('h-[52px]')
    }
  })

  it('TC-W6-T6a-4: the switch Chế độ học reflects the store and flips it', async () => {
    const user = userEvent.setup()
    renderSidebar()
    const sw = await screen.findByRole('switch', { name: 'Chế độ học' })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    await user.click(sw)
    expect(useLearningStore.getState().enabled).toBe(true)
    expect(sw).toHaveAttribute('aria-checked', 'true')
  })

  it('TC-W6-T6a-3: the learning switch broadcasts the NEW value, and a failed persist does not roll the UI back', async () => {
    const user = userEvent.setup()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    renderSidebar()
    const sw = await screen.findByRole('switch', { name: 'Chế độ học' })
    await user.click(sw)
    expect(api.settingsLearningToggle).toHaveBeenLastCalledWith(true)
    vi.mocked(api.settingsLearningToggle).mockRejectedValue(new Error('no runtime'))
    await user.click(sw)
    expect(api.settingsLearningToggle).toHaveBeenLastCalledWith(false)
    await waitFor(() => expect(warn).toHaveBeenCalled())
    expect(useLearningStore.getState().enabled).toBe(false)
    warn.mockRestore()
  })

  it('shows Không đọc được cài đặt with a retry and disables the switches when settings fail', async () => {
    const user = userEvent.setup()
    vi.mocked(api.getSettings).mockRejectedValueOnce(new Error('db')).mockResolvedValue({ ...SETTINGS })
    renderSidebar()
    expect(await screen.findByText('Không đọc được cài đặt')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Tạm dừng ghi nhận' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Thử lại' }))
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Tạm dừng ghi nhận' })).not.toBeDisabled())
  })

  it('opens Cài đặt from the footer row', async () => {
    const user = userEvent.setup()
    const { onOpenSettings } = renderSidebar()
    await user.click(screen.getByRole('button', { name: /Cài đặt/ }))
    expect(onOpenSettings).toHaveBeenCalled()
  })

  it('in the rail the switches are icon buttons with the same names', async () => {
    renderSidebar({ mode: 'rail' })
    expect(await screen.findByRole('switch', { name: 'Tạm dừng ghi nhận' })).toHaveClass('size-10')
    expect(screen.getByRole('switch', { name: 'Chế độ học' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cài đặt' })).toBeInTheDocument()
  })
})

describe('Sidebar modes', () => {
  it('full is 220px wide with a collapse button; rail is 56px with an expand button', async () => {
    const user = userEvent.setup()
    const full = renderSidebar()
    expect(full.container.firstElementChild).toHaveClass('w-sidebar')
    await user.click(screen.getByRole('button', { name: /Thu gọn thanh bên/ }))
    expect(full.onToggle).toHaveBeenCalled()
    full.unmount()
    const rail = renderSidebar({ mode: 'rail' })
    expect(rail.container.firstElementChild).toHaveClass('w-rail')
    expect(screen.getByRole('button', { name: /Mở rộng thanh bên/ })).toBeInTheDocument()
  })

  it('the overlay sits over a scrim and Esc, the scrim and choosing an item close it', async () => {
    const user = userEvent.setup()
    const o = renderSidebar({ mode: 'overlay' })
    expect(screen.getByRole('complementary')).toHaveClass('fixed', 'w-sidebar')
    await user.keyboard('{Escape}')
    expect(o.onCloseOverlay).toHaveBeenCalledTimes(1)
    await user.click(o.container.querySelector('[data-scrim]') as HTMLElement)
    expect(o.onCloseOverlay).toHaveBeenCalledTimes(2)
    await user.click(screen.getByRole('button', { name: /^Plans/ }))
    expect(o.onSelectScreen).toHaveBeenCalledWith('plans')
    expect(o.onCloseOverlay).toHaveBeenCalledTimes(3)
  })

  it('Esc does nothing when the sidebar is not an overlay', async () => {
    const user = userEvent.setup()
    const o = renderSidebar({ mode: 'full' })
    await user.keyboard('{Escape}')
    expect(o.onCloseOverlay).not.toHaveBeenCalled()
  })
})

describe('useSidebarMode', () => {
  type Listener = () => void
  function stubWidth(initial: boolean) {
    let wide = initial
    const listeners = new Set<Listener>()
    vi.stubGlobal('matchMedia', (query: string) => ({
      get matches() { return query.includes('1100') ? wide : false },
      media: query,
      addEventListener: (_: string, l: Listener) => listeners.add(l),
      removeEventListener: (_: string, l: Listener) => listeners.delete(l)
    }))
    window.matchMedia = globalThis.matchMedia
    return (next: boolean) => {
      wide = next
      listeners.forEach((l) => l())
    }
  }

  it('wide: follows the cm.sidebar choice and writes it only when the user toggles', () => {
    stubWidth(true)
    const { result } = renderHook(() => useSidebarMode())
    expect(result.current.mode).toBe('full')
    expect(localStorage.getItem('cm.sidebar')).toBeNull()
    act(() => result.current.toggle())
    expect(result.current.mode).toBe('rail')
    expect(localStorage.getItem('cm.sidebar')).toBe('rail')
    act(() => result.current.toggle())
    expect(result.current.mode).toBe('full')
  })

  it('reads a saved rail choice', () => {
    stubWidth(true)
    localStorage.setItem('cm.sidebar', 'rail')
    const { result } = renderHook(() => useSidebarMode())
    expect(result.current.mode).toBe('rail')
  })

  it('narrow: a rail that opens as an overlay, without writing the choice, and follows a width change at once', () => {
    const setWide = stubWidth(false)
    const { result } = renderHook(() => useSidebarMode())
    expect(result.current.mode).toBe('rail')
    act(() => result.current.toggle())
    expect(result.current.mode).toBe('overlay')
    expect(localStorage.getItem('cm.sidebar')).toBeNull()
    act(() => result.current.closeOverlay())
    expect(result.current.mode).toBe('rail')
    act(() => result.current.toggle())
    act(() => setWide(true))
    expect(result.current.mode).toBe('full')
    act(() => setWide(false))
    expect(result.current.mode).toBe('rail')
  })
})

describe('useLearningSync', () => {
  it('pulls the DB value into the cached store', async () => {
    vi.mocked(api.getSettings).mockResolvedValue({ ...SETTINGS, learning: true })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderHook(() => useLearningSync(), {
      wrapper: ({ children }) => React.createElement(QueryClientProvider, { client: qc }, children)
    })
    await waitFor(() => expect(useLearningStore.getState().enabled).toBe(true))
  })
})
