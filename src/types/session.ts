// Shapes of the session and cleanup commands. Mirrors src-tauri/src/sessions
// and src-tauri/src/cleanup field for field. Times are epoch seconds.

export interface SessionSummary {
  id: string
  project_dir: string | null
  /** The transcript folder name, for showing an unregistered project. */
  project_folder: string
  size: number
  created: number
  modified: number
  change_count: number
  reject_count: number
}

export interface IndexStats {
  files_total: number
  files_read: number
  bytes_read: number
  malformed_lines: number
  labelled: number
}

export type CleanupReason = 'config' | 'kept_list' | 'credential' | 'unclassified'

export interface CleanupEntry {
  path: string
  size: number
  mtime: number
  reason: CleanupReason | null
}

export interface CleanupScan {
  cutoff_days: number
  groups: {
    redundant: CleanupEntry[]
    aged: CleanupEntry[]
    never_touch: CleanupEntry[]
  }
}

export interface TrashResult {
  path: string
  ok: boolean
  /** The path was already gone; not an error. */
  gone: boolean
  error: string | null
}
