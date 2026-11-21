// App-level smoke: mounts the real <App /> over a fake Tauri transport and
// walks every screen from the sidebar (docs/plan/manager-v2/SMOKE.md §1, §6.1).
//
// What makes this different from the per-component suites: nothing here is
// mocked above the IPC boundary. The real `api` façade, the real React
// Query wiring, the real store/hook graph and the real components all run;
// only `invoke` is replaced with a command-name dispatcher. That is the
// layer where "tab renders at all" regressions actually live — a broken
// lazy import, a missing provider, a hook throwing on mount.
//
// It does NOT replace the manual checklist. Things this cannot see:
// real focus-trap behaviour, the markdown watcher round-trip, lazy-chunk
// fetching over the network, dark mode, window resizing, or persistence
// across a real relaunch. SMOKE.md marks those as manual-only.

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type MockInstance,
} from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { invoke, type InvokeArgs } from '@tauri-apps/api/core'
import React from 'react'

import App from '../App'
import { ConfirmProvider } from '../components/ui/ConfirmProvider'
import { resetIndexThrottle } from '../features/edits/EditListPanel'
import { useReviewFilterStore } from '../stores/useReviewFilterStore'

const invokeMock = vi.mocked(invoke)

const SETTINGS = {
  paused: false,
  retention_days: 30,
  anthropic_api_key: '',
  mem0_api_key: null,
  explain_model: 'claude-opus-5-5',
  autostart: false,
  learning: false,
}

const EDIT = {
  id: 'e-1',
  project_id: 'p-1',
  path: 'D:/code/demo/src/main.ts',
  tool: 'Edit',
  status: 'pending',
  created_at: '2026-08-15T00:00:00Z',
  after_blob_sha: 'sha-after',
  before_blob_sha: null,
  explanation_md: null,
  lines_added: 3,
  lines_removed: 1,
}

// Command → response. Anything unlisted resolves to `[]`, which is the
// right shape for every list-returning command in the façade; a component
// that needs something else will fail loudly here rather than silently
// rendering an empty state.
const RESPONSES: Record<string, unknown> = {
  get_settings: SETTINGS,
  list_projects: [{ id: 'p-1', name: 'demo', path: 'D:/code/demo', color: null }],
  list_edits: [EDIT],
  get_edit: EDIT,
  get_edit_diff: { before: '', after: 'console.log(1)\n' },
  memory_list: { entries: [], mem0: { state: 'available' }, problems: [] },
  settings_learning_toggle: true,
  cleanup_scan: { cutoff_days: 30, groups: { redundant: [], aged: [], never_touch: [] } },
}

function makeStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  }
}

function renderApp() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    React.createElement(QueryClientProvider, { client: qc }, <ConfirmProvider><App /></ConfirmProvider>),
  )
}

/** jsdom has no layout: give every element a 320 x 600 box so the virtual list renders its rows. */
function useListBox() {
  let spy: { mockRestore: () => void }
  beforeEach(() => {
    spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 320, height: 600, top: 0, left: 0, right: 320, bottom: 600, x: 0, y: 0, toJSON: () => ({})
    })
  })
  afterEach(() => {
    spy.mockRestore()
  })
}

const NAV = 'Điều hướng chính'

/** Click a sidebar item and wait for its (possibly lazy) chunk to mount. */
async function openTab(user: ReturnType<typeof userEvent.setup>, label: string) {
  const nav = within(screen.getByRole('navigation', { name: NAV }))
  // No manual act() wrapper: userEvent already flushes through
  // testing-library's async wrapper, and nesting act() inside it leaves
  // React's IS_REACT_ACT_ENVIRONMENT flag restored to the wrong value —
  // which shows up as a stream of "environment is not configured to
  // support act(...)" warnings, and this suite asserts console.error is
  // silent.
  await user.click(nav.getByRole('button', { name: new RegExp(`^${label.replace('&', '\\&')}`) }))
}

describe('App smoke — every screen mounts over a fake IPC transport', () => {
  let errorSpy: MockInstance<Parameters<typeof console.error>, void>
  useListBox()

  beforeEach(() => {
    invokeMock.mockReset()
    // Stateful for the one command whose result the UI reads back:
    // `useLearningSync` re-reads settings after a toggle, so a transport
    // that always replied `learning: false` would look like a bug.
    let learning = false
    invokeMock.mockImplementation((cmd: string, args?: unknown) => {
      if (cmd === 'settings_learning_toggle') {
        learning = Boolean((args as { enabled?: boolean } | undefined)?.enabled)
        return Promise.resolve(learning)
      }
      if (cmd === 'get_settings') return Promise.resolve({ ...SETTINGS, learning })
      return Promise.resolve(cmd in RESPONSES ? RESPONSES[cmd] : [])
    })
    vi.stubGlobal('localStorage', makeStorage())
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    errorSpy.mockRestore()
  })

  it('SMOKE §1: every screen renders', async () => {
    const user = userEvent.setup()
    renderApp()

    // Chờ duyệt is the default screen; the edit row proves list_edits flowed
    // through the real façade and hook.
    expect(await screen.findByText(/main\.ts/)).toBeInTheDocument()

    for (const label of ['Đã xử lý', 'Memory & lỗi', 'Plans', 'Sessions', 'Dọn dẹp']) await openTab(user, label)

    // Back to the start — screen state is not one-way.
    await openTab(user, 'Chờ duyệt')
    expect(await screen.findByText(/main\.ts/)).toBeInTheDocument()
  })

  it('SMOKE §2: the lazy Plans screen mounts', async () => {
    const user = userEvent.setup()
    renderApp()

    await openTab(user, 'Plans')
    // PlansTab is behind React.lazy — findBy waits for the chunk.
    expect(await screen.findByText('Chọn một thay đổi, spec hoặc việc nhỏ để xem chi tiết.')).toBeInTheDocument()
  })

  it('SMOKE §7: the sidebar lists the six screens in the order of the design, in the three groups', async () => {
    renderApp()
    await screen.findByText(/main\.ts/)
    const nav = within(screen.getByRole('navigation', { name: NAV }))
    const names = nav.getAllByRole('button').map((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').replace(/,.*$/, '').trim())
    expect(names).toEqual(['Chờ duyệt', 'Đã xử lý', 'Plans', 'Memory & lỗi', 'Sessions', 'Dọn dẹp'])
    expect(nav.getAllByRole('group').map((g) => within(g).getAllByRole('button').length)).toEqual([2, 2, 2])
  })

  it('shell: each screen has exactly one h1 with its title, and the window has no header, tab bar or status bar of the old shell', async () => {
    const user = userEvent.setup()
    renderApp()
    await screen.findByText(/main\.ts/)
    const titles = ['Chờ duyệt', 'Đã xử lý', 'Plans', 'Memory & lỗi', 'Sessions', 'Dọn dẹp']
    for (const title of titles) {
      await openTab(user, title)
      expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument()
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    }
    expect(screen.queryByRole('contentinfo')).toBeNull()
    expect(screen.getAllByRole('banner')).toHaveLength(1)
  })

  it('UC-001 the review screens hold no unnamed aside inside main', async () => {
    const user = userEvent.setup()
    renderApp()
    await screen.findByText(/main\.ts/)
    for (const title of ['Chờ duyệt', 'Đã xử lý']) {
      await openTab(user, title)
      await screen.findByRole('heading', { level: 1, name: title })
      expect(document.querySelectorAll('main aside:not([aria-label]):not([aria-labelledby])')).toHaveLength(0)
    }
  })

  it('shell: Ctrl+1 to 6 open the screens and move focus to the h1; the skip link is the first tab stop', async () => {
    const user = userEvent.setup()
    renderApp()
    await screen.findByText(/main\.ts/)
    const titles = ['Chờ duyệt', 'Đã xử lý', 'Plans', 'Memory & lỗi', 'Sessions', 'Dọn dẹp']
    for (const [i, title] of titles.entries()) {
      await user.keyboard(`{Control>}${i + 1}{/Control}`)
      const h1 = await screen.findByRole('heading', { level: 1, name: title })
      await waitFor(() => expect(h1).toHaveFocus())
    }
    const focused = document.activeElement as HTMLElement
    focused.blur()
    await user.tab()
    expect(screen.getByRole('link', { name: 'Bỏ qua tới nội dung chính' })).toHaveFocus()
  })

  it('shell: the question mark opens the shortcut sheet', async () => {
    const user = userEvent.setup()
    renderApp()
    await screen.findByText(/main\.ts/)
    await user.keyboard('?')
    expect(await screen.findByRole('dialog', { name: 'Phím tắt' })).toBeInTheDocument()
  })

  it('shell: the Cài đặt row of the sidebar opens the lazy Settings dialog', async () => {
    const user = userEvent.setup()
    renderApp()
    await screen.findByText(/main\.ts/)
    await user.click(screen.getByRole('button', { name: 'Cài đặt' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('UC-004 / AC-3: Xem thay đổi opens Pending with a pending change, else History, and no removed tab exists', async () => {
    const SESSION = (id: string) => ({
      id, project_dir: 'D:/code/demo', project_folder: '-D-code-demo', size: 1000,
      created: 1_790_000_000, modified: 1_790_000_100, change_count: 2, reject_count: 0,
    })
    const saved = { list_edits: RESPONSES.list_edits }
    RESPONSES.sessions_list = [SESSION('sess-pend-0000'), SESSION('sess-done-0000')]
    RESPONSES.list_edits = [
      { ...EDIT, id: 'e-p', session_id: 'sess-pend-0000', status: 'pending' },
      { ...EDIT, id: 'e-d', session_id: 'sess-done-0000', status: 'accepted' },
    ]
    try {
      const user = userEvent.setup()
      renderApp()
      await screen.findByText(/main\.ts/)
      const nav = within(screen.getByRole('navigation', { name: NAV }))
      for (const removed of ['Knowledge', 'Practice', 'Config', 'Audit']) {
        expect(nav.queryByRole('button', { name: new RegExp(removed) })).toBeNull()
      }
      const isActive = (label: string) =>
        nav.getByRole('button', { name: new RegExp(`^${label}`) }).getAttribute('aria-current') === 'page'

      await openTab(user, 'Sessions')
      const card = async (id: string) =>
        (await screen.findByText(id.slice(0, 8))).closest('[role="listitem"]') as HTMLElement
      await user.click(within(await card('sess-pend-0000')).getByRole('button', { name: 'Xem thay đổi' }))
      await waitFor(() => expect(isActive('Chờ duyệt')).toBe(true))

      await openTab(user, 'Sessions')
      await user.click(within(await card('sess-done-0000')).getByRole('button', { name: 'Xem thay đổi' }))
      await waitFor(() => expect(isActive('Đã xử lý')).toBe(true))
    } finally {
      delete RESPONSES.sessions_list
      RESPONSES.list_edits = saved.list_edits
      // the session filter lives in a module-level store; do not leak it to other cases
      useReviewFilterStore.setState({ claudeOnly: { pending: false, history: false }, sessionId: null })
    }
  })

  it('a screen crashed by cached bad data recovers on Tải lại màn này once the backend answers well', async () => {
    const user = userEvent.setup()
    const base = invokeMock.getMockImplementation()!
    let good = false
    invokeMock.mockImplementation((cmd: string, args?: InvokeArgs) =>
      cmd === 'sessions_list'
        ? Promise.resolve(good ? [{
            id: 'sess-ok-00000', project_dir: 'D:/code/demo', project_folder: '-D-code-demo', size: 1000,
            created: 1_790_000_000, modified: 1_790_000_100, change_count: 2, reject_count: 0,
          }] : { broken: true })
        : base(cmd, args)
    )
    // The default gcTime keeps the bad payload cached while the crash card shows, as in the real app.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(React.createElement(QueryClientProvider, { client: qc }, <ConfirmProvider><App /></ConfirmProvider>))
    await screen.findByText(/main\.ts/)
    await openTab(user, 'Sessions')
    expect(await screen.findByTestId('tab-error')).toBeInTheDocument()
    good = true
    const reads = (cmd: string) => invokeMock.mock.calls.filter((c) => c[0] === cmd).length
    const before = { projects: reads('list_projects'), settings: reads('get_settings') }
    await user.click(screen.getByRole('button', { name: 'Tải lại màn này' }))
    expect(await screen.findByText('sess-ok-')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Sessions theo project' })).toBeInTheDocument()
    expect({ projects: reads('list_projects'), settings: reads('get_settings') }).toEqual(before)
  })

  it('SMOKE §8: choosing a project passes it to Memory, and the choice persists in cm.activeProject', async () => {
    const user = userEvent.setup()
    renderApp()
    await screen.findByText(/main\.ts/)
    await user.click(screen.getByRole('button', { name: /^Project/ }))
    await user.click(await screen.findByRole('menuitemradio', { name: 'demo' }))
    expect(JSON.stringify(localStorage.getItem('cm.activeProject'))).toBe('"p-1"')
    await openTab(user, 'Memory & lỗi')
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('memory_list', { project: 'D:/code/demo' })
    )
  })

  it('SMOKE §5: the learning toggle round-trips through the IPC layer', async () => {
    const user = userEvent.setup()
    renderApp()

    const btn = await screen.findByRole('switch', { name: 'Chế độ học' })
    expect(btn).toHaveAttribute('aria-checked', 'false')

    await user.click(btn)

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('settings_learning_toggle', {
        enabled: true,
      }),
    )
    expect(btn).toHaveAttribute('aria-checked', 'true')
  })

  it('SMOKE §6.1: walking every screen twice logs no console error', async () => {
    const user = userEvent.setup()
    renderApp()
    await screen.findByText(/main\.ts/)

    for (let round = 0; round < 2; round++) {
      for (const label of [
        'Đã xử lý',
        'Memory & lỗi',
        'Sessions',
        'Plans',
        'Dọn dẹp',
        'Chờ duyệt',
      ]) {
        await openTab(user, label)
      }
    }

    // Any React error boundary trip, failed lazy import, or invalid-prop
    // warning lands here. An empty call list is the assertion.
    const messages = errorSpy.mock.calls.map((c) => String(c[0]))
    expect(messages, messages.join('\n---\n')).toEqual([])
  })

  it('UC-001/AC-12: a filter that hides the selected change clears the selection', async () => {
    const user = userEvent.setup()
    renderApp()
    await user.click(await screen.findByText(/main\.ts/))
    await waitFor(() => expect(screen.queryByText('Chọn một thay đổi để xem chi tiết')).toBeNull())
    try {
      act(() => useReviewFilterStore.setState({ sessionId: 'sess-other' }))
      expect(await screen.findByText('Chọn một thay đổi để xem chi tiết')).toBeInTheDocument()
    } finally {
      useReviewFilterStore.setState({ claudeOnly: { pending: false, history: false }, sessionId: null })
    }
  })

  it('UC-001/AC-14: a failed read of the session history shows and is read again on the next opening', async () => {
    resetIndexThrottle()
    const base = invokeMock.getMockImplementation()!
    invokeMock.mockImplementation((cmd: string, args?: InvokeArgs) =>
      cmd === 'sessions_refresh' ? Promise.reject(new Error('boom')) : base(cmd, args)
    )
    const refreshes = () => invokeMock.mock.calls.filter((c) => c[0] === 'sessions_refresh').length
    const user = userEvent.setup()
    renderApp()
    expect(await screen.findByText(/Không đọc được lịch sử session: boom/)).toBeInTheDocument()
    expect(refreshes()).toBe(1)
    await openTab(user, 'Plans')
    await openTab(user, 'Chờ duyệt')
    expect(await screen.findByText(/Không đọc được lịch sử session: boom/)).toBeInTheDocument()
    expect(refreshes()).toBe(2)
    resetIndexThrottle()
  })
  it('UC-001/AC-12 one edits-changed event makes one list_edits call for the sidebar, the subtitle and the list together', async () => {
    const { listen } = await import('@tauri-apps/api/event')
    renderApp()
    await screen.findByText(/main\.ts/)
    const listCalls = () => invokeMock.mock.calls.filter((c) => c[0] === 'list_edits').length
    const before = listCalls()
    const handler = vi.mocked(listen).mock.calls.filter((c) => c[0] === 'edits-changed').at(-1)![1] as () => void
    act(() => handler())
    await waitFor(() => expect(listCalls()).toBe(before + 1))
    await act(async () => { await new Promise((r) => setTimeout(r, 150)) })
    expect(listCalls()).toBe(before + 1)
  })

  it('a failed list shows "Không tải được danh sách thay đổi" with Thử lại instead of the empty state, and Thử lại reads again', async () => {
    const base = invokeMock.getMockImplementation()!
    let failing = true
    invokeMock.mockImplementation((cmd: string, args?: InvokeArgs) =>
      cmd === 'list_edits' && failing ? Promise.reject(new Error('db locked')) : base(cmd, args)
    )
    const user = userEvent.setup()
    renderApp()
    expect(await screen.findByText('Không tải được danh sách thay đổi')).toBeInTheDocument()
    expect(screen.getByText('db locked')).toBeInTheDocument()
    expect(screen.queryByText('Không còn thay đổi nào chờ duyệt')).toBeNull()
    failing = false
    await user.click(screen.getByRole('button', { name: 'Thử lại' }))
    expect(await screen.findByText(/main\.ts/)).toBeInTheDocument()
  })

  it('the bulk buttons sit in the Chờ duyệt header and are on every screen but that one absent', async () => {
    const user = userEvent.setup()
    renderApp()
    await screen.findByText(/main\.ts/)
    const header = screen.getByRole('heading', { level: 1, name: 'Chờ duyệt' }).closest('header')!
    expect(within(header).getByRole('button', { name: /Chấp nhận tất cả/ })).toBeInTheDocument()
    expect(within(header).getByRole('button', { name: /Từ chối tất cả/ })).toBeInTheDocument()
    await openTab(user, 'Đã xử lý')
    expect(screen.queryByRole('button', { name: /Chấp nhận tất cả/ })).toBeNull()
  })
})
