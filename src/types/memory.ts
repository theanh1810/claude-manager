// Shapes of memory_list. Mirrors src-tauri/src/memory/mod.rs field for field.

export type MemoryKind = 'memory' | 'error'

/** A file entry names its path and start line; a mem0 entry its id and entity. */
export type MemorySource =
  | { path: string; line: number }
  | { mem0_id: string; entity: string }

export interface MemoryEntry {
  id: string
  kind: MemoryKind
  /** Project name; null for global memory and mem0. */
  project: string | null
  source: MemorySource
  text: string
}

export type ErrorEntry = MemoryEntry & { kind: 'error' }

export type Mem0ReasonKind =
  | 'no_key'
  | 'connection'
  | 'timeout'
  | 'auth_401_403'
  | 'http_other'
  | 'bad_reply'

export type Mem0Status =
  | { state: 'available' }
  | { state: 'unavailable'; reason: Mem0ReasonKind; status: number | null }

export interface MemoryProblem {
  path: string
  error: string
}

export interface MemoryList {
  entries: MemoryEntry[]
  mem0: Mem0Status
  problems: MemoryProblem[]
}
