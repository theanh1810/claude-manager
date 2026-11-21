// Shapes of plans_tree and plans_change. Mirrors src-tauri/src/plans.rs, src-tauri/src/specs/plan_files.rs and
// src-tauri/src/specs/errors.rs key for key. Every path is relative to the project and is what plans_read takes.
// Ordering is done by the backend; render the arrays as received.

export type PlanApproval = 'approved' | 'not_approved' | 'stale'

export type PlanVerdict = 'red' | 'yellow' | 'green'

export interface PlanChangeRow {
  /** The folder name; for a closed change without its YYYY-MM-DD- prefix. */
  id: string
  /** What plansChange takes. */
  dir: string
  /** True exactly when the folder is under openspec/changes/archive/. */
  closed: boolean
  archived_date: string | null
  /** Null, with tasks_total, when the change has no tasks.md or one that cannot be read or summarised. */
  tasks_done: number | null
  tasks_total: number | null
  /** True when tasks.md exists but could not be read or has no task line. */
  tasks_unreadable: boolean
  approval: PlanApproval
  /** Verdict of the newest round of errors.yaml; null without a readable one. */
  latest_verdict: PlanVerdict | null
  /** Milliseconds since the epoch of the newest file in the folder. */
  modified_at: number | null
}

export interface PlanSpecRow {
  capability: string
  path: string
}

export interface AdhocRow {
  slug: string
  /** YYYY-MM-DD; null for a folder without a date prefix. */
  date: string | null
  dir: string
  has_record: boolean
  has_independent: boolean
}

export interface PlansTree {
  /** 'missing' when the project has no openspec/ folder; adhoc is filled either way. */
  openspec: 'present' | 'missing'
  /** Open changes first, then closed ones. */
  changes: PlanChangeRow[]
  specs: PlanSpecRow[]
  /** Path of openspec/_debt.md; null when it does not exist. */
  debt: string | null
  /** Path of openspec/glossary.md; null when it does not exist. */
  glossary: string | null
  adhoc: AdhocRow[]
}

/** A plan file as the detail shows it; unreadable carries the file text as written, error the reason it could not be read. */
export type PlanSection<T> =
  | { state: 'missing' }
  | ({ state: 'ok' } & T)
  | { state: 'unreadable'; raw: string }
  | { state: 'error'; message: string }

export interface PlanTaskItem {
  id: string
  title: string
  done: boolean
}

export interface PlanWave {
  /** The n of "## Wave n"; null for task lines under no such heading, listed last. */
  wave: number | null
  done: number
  total: number
  tasks: PlanTaskItem[]
}

export interface PlanTasksOk {
  done: number
  total: number
  waves: PlanWave[]
}

export interface PlanReviewRound {
  n: number
  kind: string
  /** The text under the round heading, as written. */
  markdown: string
}

export interface PlanReviewOk {
  /** Newest round first. */
  rounds: PlanReviewRound[]
}

export interface PlanErrorRound {
  n: number
  verdict: PlanVerdict
  /** Entries of the round without closed_in, by severity. */
  critical: number
  major: number
  minor: number
}

export interface PlanErrorsOk {
  /** Newest round first. */
  rounds: PlanErrorRound[]
}

export interface PlanDocRef {
  /** Relative to the change. */
  label: string
  path: string
}

export interface PlanChangeDetail {
  id: string
  dir: string
  closed: boolean
  archived_date: string | null
  approval: PlanApproval
  tasks: PlanSection<PlanTasksOk>
  review: PlanSection<PlanReviewOk>
  errors: PlanSection<PlanErrorsOk>
  docs: PlanDocRef[]
}
