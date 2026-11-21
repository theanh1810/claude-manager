// Binding tests for the Tauri IPC façade in src/lib/ipc.ts.
//
// Goal: lock in the exact command names + argument shape the frontend sends
// to the Rust backend. If a Rust #[tauri::command] gets renamed or its
// argument key drifts, these tests fail loudly here — instead of silently
// at runtime in production.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { invoke } from '@tauri-apps/api/core'
import { api } from './ipc'

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

describe('api binding shape', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    invokeMock.mockResolvedValue(undefined)
  })

  it('listEdits forwards filter under the `filter` key', async () => {
    await api.listEdits({ limit: 50, status: 'pending' })
    expect(invokeMock).toHaveBeenCalledWith('list_edits', {
      filter: { limit: 50, status: 'pending' }
    })
  })

  it('getEdit sends id under `id` key', async () => {
    await api.getEdit('edit-123')
    expect(invokeMock).toHaveBeenCalledWith('get_edit', { id: 'edit-123' })
  })

  it('getEditDiff sends id under `id` key', async () => {
    await api.getEditDiff('edit-xyz')
    expect(invokeMock).toHaveBeenCalledWith('get_edit_diff', { id: 'edit-xyz' })
  })

  it('acceptEdit / rejectEdit / rollbackEdit all use the `id` key', async () => {
    await api.acceptEdit('a')
    await api.rejectEdit('b')
    await api.rollbackEdit('c')
    expect(invokeMock).toHaveBeenNthCalledWith(1, 'accept_edit', { id: 'a' })
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'reject_edit', { id: 'b' })
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'rollback_edit', { id: 'c' })
  })

  it('addProject forwards name + color when provided', async () => {
    await api.addProject('/abs/path', 'My Project', '#ff0000')
    expect(invokeMock).toHaveBeenCalledWith('add_project', {
      path: '/abs/path',
      name: 'My Project',
      color: '#ff0000'
    })
  })

  it('acceptAll / rejectAll send projectPath in camelCase as Tauri convention', async () => {
    // Tauri 2.x default convention is camelCase on the JS side which Tauri
    // converts to snake_case on the Rust side. Verify we are not sending
    // snake_case here (regression: an earlier version used project_path).
    await api.acceptAll('/some/path')
    expect(invokeMock).toHaveBeenCalledWith('accept_all', {
      projectPath: '/some/path'
    })
  })

  it('sessions commands send the exact names and keys', async () => {
    await api.sessionsRefresh()
    await api.sessionsList('/p')
    await api.sessionsList()
    await api.sessionTrash('s1')
    expect(invokeMock).toHaveBeenNthCalledWith(1, 'sessions_refresh')
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'sessions_list', { project: '/p' })
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'sessions_list', { project: null })
    expect(invokeMock).toHaveBeenNthCalledWith(4, 'session_trash', { id: 's1' })
  })

  it('memory commands send the exact names and keys', async () => {
    await api.memoryList('/p')
    await api.memoryList()
    await api.memoryOpenFile('/p/.claude/MEMORY.md')
    expect(invokeMock).toHaveBeenNthCalledWith(1, 'memory_list', { project: '/p' })
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'memory_list', { project: null })
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'memory_open_file', { path: '/p/.claude/MEMORY.md' })
  })

  it('plan commands send the exact names and keys, relPath in camelCase', async () => {
    await api.plansTree('/p')
    await api.plansChange('/p', 'openspec/changes/demo')
    await api.plansRead('/p', 'openspec/changes/demo/plan.vi.md')
    expect(invokeMock).toHaveBeenNthCalledWith(1, 'plans_tree', { project: '/p' })
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'plans_change', {
      project: '/p',
      dir: 'openspec/changes/demo'
    })
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'plans_read', {
      project: '/p',
      relPath: 'openspec/changes/demo/plan.vi.md'
    })
  })

  it('cleanup commands send cutoffDays and paths', async () => {
    await api.cleanupScan(30)
    await api.cleanupTrash(['/a', '/b'])
    expect(invokeMock).toHaveBeenNthCalledWith(1, 'cleanup_scan', { cutoffDays: 30 })
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'cleanup_trash', { paths: ['/a', '/b'] })
  })

  it('UC-003/AC-8 the api offers no plan comment, plan suggestion or change map wrapper', () => {
    const names = Object.keys(api)
    for (const gone of ['planCommentAppend', 'planCommentsRead', 'applyPlanSuggestion', 'changeMapsList', 'changeMapRead']) {
      expect(names).not.toContain(gone)
    }
  })

  it('autostart and the app version go to their plugins with no arguments', async () => {
    await api.autostartEnable()
    await api.autostartDisable()
    await api.autostartIsEnabled()
    await api.appVersion()
    expect(invokeMock.mock.calls).toEqual([
      ['plugin:autostart|enable'],
      ['plugin:autostart|disable'],
      ['plugin:autostart|is_enabled'],
      ['plugin:app|version'],
    ])
  })

  it('the plugin commands ipc.ts invokes are registered and permitted on the Rust side', () => {
    const app = readFileSync('src-tauri/src/app.rs', 'utf8')
    const capability = JSON.parse(readFileSync('src-tauri/capabilities/default.json', 'utf8')) as { permissions: string[] }
    expect(app).toContain('tauri_plugin_autostart::init(')
    expect(capability.permissions).toEqual(expect.arrayContaining(['autostart:default', 'core:default']))
  })

  it('every command ipc.ts invokes is registered in app.rs, or belongs to a plugin', async () => {
    for (const call of Object.values(api)) await (call as () => Promise<unknown>)()
    const sent = invokeMock.mock.calls.map(([command]) => command)
    expect(sent).toHaveLength(Object.keys(api).length)
    const own = sent.filter((c) => !c.startsWith('plugin:'))
    expect(registeredCommands()).toEqual(expect.arrayContaining(own))
    expect(sent.filter((c) => c.startsWith('plugin:'))).toEqual([
      'plugin:autostart|enable',
      'plugin:autostart|disable',
      'plugin:autostart|is_enabled',
      'plugin:app|version',
    ])
  })

})
