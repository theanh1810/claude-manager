export type EditStatus =
  | 'pending'
  | 'pending_decision'
  | 'accepted'
  | 'rejected'
  | 'rolled_back'
  | 'auto_accepted'

export type HookPhase = 'pre' | 'post'

export type Tool = 'Edit' | 'Write' | 'NotebookEdit'

export interface Edit {
  id: string
  session_id: string | null
  tool: Tool
  path: string
  before_blob_sha: string | null
  after_blob_sha: string
  status: EditStatus
  hook_phase: HookPhase
  created_at: string
  decided_at: string | null
  explanation_md: string | null
  explanation_cached_at: string | null
  rollback_of_edit_id: string | null
  /**
   * Who made the change, from the session-history match: `claude`, `unknown`,
   * or absent when it was never matched. `session_id` above carries the
   * session of a `claude` match.
   */
  source?: 'claude' | 'unknown' | null
  /** What Claude Code decided for the matching call: `accept` or `reject`. */
  decision?: string | null
}

export interface Project {
  id: string
  name: string
  path: string
  color: string | null
  added_at: string
  last_opened_at: string | null
}

export interface Settings {
  paused: boolean
  retention_days: number
  anthropic_api_key: string
  /** Key of the read-only mem0 view; null when none is stored. */
  mem0_api_key: string | null
  explain_model: string
  autostart: boolean
  /**
   * Learning mode. The DB owns this (see settings.rs `set_learning`) —
   * `explain` and the CLI read it there. `useLearningStore` keeps a
   * localStorage copy only so the header button does not flash on start.
   */
  learning: boolean
}
