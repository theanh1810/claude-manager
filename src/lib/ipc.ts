import { invoke } from '@tauri-apps/api/core'
import type { Edit, Project, Settings } from '@/types/edit'
import type { MemoryList } from '@/types/memory'
import type { PlanChangeDetail, PlansTree } from '@/types/spec'
import type {
  CleanupScan,
  IndexStats,
  SessionSummary,
  TrashResult,
} from '@/types/session'

export const api = {
  listEdits: (filter?: { status?: string; project?: string; limit?: number; since?: string; until?: string }) =>
    invoke<Edit[]>('list_edits', { filter }),
  getEdit: (id: string) => invoke<Edit>('get_edit', { id }),
  getEditDiff: (id: string) =>
    invoke<{ before: string; after: string; path: string }>('get_edit_diff', { id }),
  acceptEdit: (id: string) => invoke<void>('accept_edit', { id }),
  // confirmLegacy is sent only when true: Rust reads a missing value as false.
  rejectEdit: (id: string, confirmLegacy = false) =>
    invoke<void>('reject_edit', confirmLegacy ? { id, confirmLegacy } : { id }),
  rollbackEdit: (id: string, confirmLegacy = false) =>
    invoke<void>('rollback_edit', confirmLegacy ? { id, confirmLegacy } : { id }),
  explainEdit: (id: string) => invoke<string>('explain_edit', { id }),
  getSettings: () => invoke<Settings>('get_settings'),
  updateSettings: (patch: Partial<Settings>) => invoke<Settings>('update_settings', { patch }),
  togglePause: () => invoke<boolean>('toggle_pause'),
  listProjects: () => invoke<Project[]>('list_projects'),
  addProject: (path: string, name?: string, color?: string) =>
    invoke<Project>('add_project', { path, name, color }),
  removeProject: (id: string) => invoke<void>('remove_project', { id }),
  touchProject: (id: string) => invoke<void>('touch_project', { id }),
  acceptAll: (projectPath?: string) =>
    invoke<{ success: number; failed: number; errors: string[] }>('accept_all', {
      projectPath
    }),
  rejectAll: (projectPath?: string) =>
    invoke<{ success: number; failed: number; errors: string[] }>('reject_all', {
      projectPath
    }),

  /**
   * Persist a learning-mode change and broadcast `learning-changed`.
   * Returns the stored value. The settings row is the owner — `explain`
   * and the CLI read it there; the Zustand store is a warm-start cache.
   * The renderer never subscribes to its own event.
   */
  settingsLearningToggle: (enabled: boolean) =>
    invoke<boolean>('settings_learning_toggle', { enabled }),

  // ---------------------------------------------------------------------
  // Sessions, memory, specs and cleanup. Argument keys are camelCase; Tauri
  // converts them to the snake_case Rust names (rel_path, cutoff_days).
  // ---------------------------------------------------------------------

  /** Index new session history, then label recorded changes. */
  sessionsRefresh: () => invoke<IndexStats>('sessions_refresh'),

  sessionsList: (project?: string | null) =>
    invoke<SessionSummary[]>('sessions_list', { project: project ?? null }),

  /** Move one session to the Trash; one result per path moved. */
  sessionTrash: (id: string) => invoke<TrashResult[]>('session_trash', { id }),

  memoryList: (project?: string | null) =>
    invoke<MemoryList>('memory_list', { project: project ?? null }),

  /** Open a source file that memoryList returned. */
  memoryOpenFile: (path: string) => invoke<void>('memory_open_file', { path }),

  /** Changes, live specs and adhoc runs of a registered project, read from disk now. */
  plansTree: (project: string) => invoke<PlansTree>('plans_tree', { project }),

  /** One change; `dir` is the `dir` of a PlanChangeRow. */
  plansChange: (project: string, dir: string) =>
    invoke<PlanChangeDetail>('plans_change', { project, dir }),

  /** The text of a plan file; `relPath` is relative to the project and under openspec/ or docs/changes/adhoc/. */
  plansRead: (project: string, relPath: string) => invoke<string>('plans_read', { project, relPath }),

  /** Scan ~/.claude for a cut-off of 7, 30 or 90 days. */
  cleanupScan: (cutoffDays: number) => invoke<CleanupScan>('cleanup_scan', { cutoffDays }),

  cleanupTrash: (paths: string[]) => invoke<TrashResult[]>('cleanup_trash', { paths }),

  // ---------------------------------------------------------------------
  // Tauri plugins, called by their own command names (no app.rs handler).
  // The Rust side registers the autostart plugin and permits all four in
  // capabilities/default.json; ipc.test.ts checks both.
  // ---------------------------------------------------------------------

  /** Register the app as a login item. */
  autostartEnable: () => invoke<void>('plugin:autostart|enable'),
  autostartDisable: () => invoke<void>('plugin:autostart|disable'),
  /** What the operating system has, which can differ from the stored `autostart` flag. */
  autostartIsEnabled: () => invoke<boolean>('plugin:autostart|is_enabled'),
  /** The version of the running app (what `getVersion()` of @tauri-apps/api/app returns). */
  appVersion: () => invoke<string>('plugin:app|version'),
}

/** Alias for {@link api}; both names point to the same object. */
export const ipc = api
