// App-level regression for the A/R keys (T5, review N2): after a decision the keys stay locked
// until the refresh resolved and the next change is selected, then work again on that change.
// Same fake IPC boundary as appSmoke.test.tsx: only `invoke` is replaced.

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'
import React from 'react'

import App from '../App'
import { ConfirmProvider } from '../components/ui/ConfirmProvider'

const invokeMock = vi.mocked(invoke)

const SETTINGS = {
  paused: false, retention_days: 30, anthropic_api_key: '', mem0_api_key: null,
  explain_model: 'claude-opus-5-5', autostart: false, learning: false,
}
const edit = (id: string, file: string) => ({
  id, project_id: 'p-1', path: `D:/code/demo/src/${file}`, tool: 'Edit', status: 'pending',
  created_at: '2026-08-15T00:00:00Z', after_blob_sha: 'sha-after', before_blob_sha: null,
  explanation_md: null, lines_added: 3, lines_removed: 1,
})
const E1 = edit('e-1', 'one.ts')
const E2 = edit('e-2', 'two.ts')
const E3 = edit('e-3', 'three.ts')

function makeStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size },
  }
}

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

/** Transport where the list after the first decision is held until `release()`. */
function setupTransport(decisionCmd: 'accept_edit' | 'reject_edit', first: unknown[] = [E1, E2], after: unknown[] = [E2]) {
  let decided = false
  const held = deferred<unknown>()
  invokeMock.mockImplementation((cmd: string, args?: unknown) => {
    if (cmd === decisionCmd) {
      decided = true
      return Promise.resolve(undefined)
    }
    if (cmd === 'list_edits') return decided ? held.promise : Promise.resolve(first)
    if (cmd === 'get_edit') return Promise.resolve([E1, E2, E3].find((e) => e.id === (args as { id: string }).id) ?? E1)
    if (cmd === 'get_settings') return Promise.resolve(SETTINGS)
    if (cmd === 'get_edit_diff') return Promise.resolve({ before: '', after: 'x\n' })
    if (cmd === 'list_projects') return Promise.resolve([{ id: 'p-1', name: 'demo', path: 'D:/code/demo', color: null }])
    return Promise.resolve([])
  })
  return { release: () => held.resolve(after) }
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

const decisionCalls = (cmd: string) => invokeMock.mock.calls.filter((c) => c[0] === cmd)

function renderApp() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(React.createElement(QueryClientProvider, { client: qc }, <ConfirmProvider><App /></ConfirmProvider>))
}

/** The list does not preselect: click e1's row and wait for its detail to load. */
async function selectFirst(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByText(/one\.ts/))
  await waitFor(() => expect(decisionCalls('get_edit')).toHaveLength(1))
}

describe('App keys: A/R lock until the refresh resolved and the next change is selected', () => {
  let errorSpy: MockInstance
  useListBox()
  beforeEach(() => {
    invokeMock.mockReset()
    vi.stubGlobal('localStorage', makeStorage())
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    errorSpy.mockRestore()
  })

  for (const [key, cmd] of [['a', 'accept_edit'], ['r', 'reject_edit']] as const) {
    it(`UC-001/AC-13 UC-004: '${key}' decides e1, then e2 after the refresh released`, async () => {
      const user = userEvent.setup()
      const t = setupTransport(cmd)
      renderApp()
      await selectFirst(user)

      await user.keyboard(key)
      await waitFor(() => expect(decisionCalls(cmd)).toHaveLength(1))
      expect(decisionCalls(cmd)[0][1]).toMatchObject({ id: 'e-1' })

      await act(async () => { t.release() })
      await waitFor(() => expect(screen.queryByText(/one\.ts/)).not.toBeInTheDocument())
      await waitFor(() => expect(invokeMock.mock.calls.some((c) => c[0] === 'get_edit' && (c[1] as { id: string }).id === 'e-2')).toBe(true))

      await user.keyboard(key)
      await waitFor(() => expect(decisionCalls(cmd)).toHaveLength(2))
      expect(decisionCalls(cmd)[1][1]).toMatchObject({ id: 'e-2' })
    })
  }

  it("UC-001/AC-13 a quick second press does not act on the next change: a second 'a' before the refresh releases is ignored", async () => {
    const user = userEvent.setup()
    const t = setupTransport('accept_edit')
    renderApp()
    await selectFirst(user)

    await user.keyboard('a')
    await waitFor(() => expect(decisionCalls('accept_edit')).toHaveLength(1))
    await user.keyboard('a')
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    expect(decisionCalls('accept_edit')).toHaveLength(1)
    await act(async () => { t.release() })
  })
})

describe('App keys: A waits for the selected change to load', () => {
  let errorSpy: MockInstance
  useListBox()
  beforeEach(() => {
    invokeMock.mockReset()
    vi.stubGlobal('localStorage', makeStorage())
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    errorSpy.mockRestore()
  })

  it('UC-001/AC-13 A does nothing until the selected change has loaded, then accepts it', async () => {
    const user = userEvent.setup()
    const held = deferred<unknown>()
    invokeMock.mockImplementation((cmd: string, args?: unknown) => {
      const id = (args as { id?: string } | undefined)?.id
      if (cmd === 'accept_edit') return Promise.resolve(undefined)
      if (cmd === 'list_edits') return Promise.resolve([E1, E2])
      if (cmd === 'get_edit') return Promise.resolve([E1, E2].find((e) => e.id === id) ?? E1)
      if (cmd === 'get_edit_diff') return id === 'e-2' ? held.promise : Promise.resolve({ before: '', after: 'x\n' })
      if (cmd === 'get_settings') return Promise.resolve(SETTINGS)
      if (cmd === 'list_projects') return Promise.resolve([{ id: 'p-1', name: 'demo', path: 'D:/code/demo', color: null }])
      return Promise.resolve([])
    })
    renderApp()
    await selectFirst(user)
    await user.click(await screen.findByText(/two\.ts/))
    await waitFor(() => expect(invokeMock.mock.calls.some((c) => c[0] === 'get_edit_diff' && (c[1] as { id: string }).id === 'e-2')).toBe(true))
    await user.keyboard('a')
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(decisionCalls('accept_edit')).toHaveLength(0)
    await act(async () => { held.resolve({ before: '', after: 'y\n' }) })
    await user.keyboard('a')
    await waitFor(() => expect(decisionCalls('accept_edit')).toHaveLength(1))
    expect(decisionCalls('accept_edit')[0][1]).toMatchObject({ id: 'e-2' })
  })
})

describe('App keys: j and k move the selection of the primary list', () => {
  let errorSpy: MockInstance
  useListBox()
  beforeEach(() => {
    invokeMock.mockReset()
    vi.stubGlobal('localStorage', makeStorage())
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    errorSpy.mockRestore()
  })

  const shown = (id: string) => invokeMock.mock.calls.some((c) => c[0] === 'get_edit' && (c[1] as { id: string }).id === id)

  it('UC-001/AC-18 j moves the selection to the next change and k to the previous one', async () => {
    const user = userEvent.setup()
    setupTransport('accept_edit')
    renderApp()
    await selectFirst(user)
    expect(screen.getByRole('listbox', { name: 'Thay đổi chờ duyệt' })).toHaveAttribute('data-primary-list')
    await user.keyboard('j')
    await waitFor(() => expect(shown('e-2')).toBe(true))
    expect(screen.getByRole('option', { name: /two\.ts/ })).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('k')
    await waitFor(() => expect(screen.getByRole('option', { name: /one\.ts/ })).toHaveAttribute('aria-selected', 'true'))
  })

  it('UC-001/AC-18 j waits while a key decision is in flight and works again once the next change is shown', async () => {
    const user = userEvent.setup()
    const t = setupTransport('accept_edit', [E1, E2, E3], [E2, E3])
    renderApp()
    await selectFirst(user)
    await user.keyboard('a')
    await waitFor(() => expect(decisionCalls('accept_edit')).toHaveLength(1))
    await user.keyboard('j')
    await user.keyboard('{ArrowDown}')
    // The advance already chose e-2; neither j nor the list's own arrow may move on to e-3 before the refresh is shown.
    await waitFor(() => expect(shown('e-2')).toBe(true))
    expect(shown('e-3')).toBe(false)
    await act(async () => { t.release() })
    await waitFor(() => expect(screen.queryByText(/one\.ts/)).not.toBeInTheDocument())
    expect(shown('e-3')).toBe(false)
    await user.keyboard('j')
    await waitFor(() => expect(shown('e-3')).toBe(true))
  })

  it('UC-001/AC-13 a letter typed in the open project menu decides nothing and moves nothing', async () => {
    const user = userEvent.setup()
    setupTransport('accept_edit')
    renderApp()
    await selectFirst(user)
    await user.click(screen.getByRole('button', { name: /^Project/ }))
    await screen.findByRole('menu')
    await user.keyboard('r')
    await user.keyboard('a')
    await user.keyboard('j')
    expect(decisionCalls('reject_edit')).toHaveLength(0)
    expect(decisionCalls('accept_edit')).toHaveLength(0)
    expect(shown('e-2')).toBe(false)
    expect(screen.getByRole('option', { name: /one\.ts/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('UC-001/AC-18 j typed in the search field does not move the selection', async () => {
    const user = userEvent.setup()
    setupTransport('accept_edit')
    renderApp()
    await selectFirst(user)
    await user.keyboard('/')
    const search = screen.getByRole('searchbox', { name: 'Tìm path / tool…' })
    expect(search).toHaveFocus()
    await user.keyboard('j')
    expect(search).toHaveValue('j')
    expect(shown('e-2')).toBe(false)
  })

  it('UC-001/AC-18 j while a dialog is open does not move the selection', async () => {
    const user = userEvent.setup()
    setupTransport('accept_edit')
    renderApp()
    await selectFirst(user)
    await user.keyboard('{Control>},{/Control}')
    await screen.findByRole('dialog')
    await user.keyboard('j')
    expect(shown('e-2')).toBe(false)
    expect(decisionCalls('accept_edit')).toHaveLength(0)
  })

  it('/ focuses the search box of the list', async () => {
    const user = userEvent.setup()
    setupTransport('accept_edit')
    renderApp()
    await screen.findByText(/one\.ts/)
    await user.keyboard('/')
    expect(screen.getByRole('searchbox', { name: 'Tìm path / tool…' })).toHaveFocus()
  })

  it('does nothing when the screen shows no list: an empty Đã xử lý', async () => {
    const user = userEvent.setup()
    setupTransport('accept_edit')
    renderApp()
    await selectFirst(user)
    await user.keyboard('{Control>}2{/Control}')
    await screen.findByText('Chưa có thay đổi nào đã xử lý')
    expect(document.querySelector('[data-primary-list]')).toBeNull()
    await user.keyboard('j')
    expect(screen.getByRole('heading', { level: 1, name: 'Đã xử lý' })).toBeInTheDocument()
  })
})
