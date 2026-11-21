import { useMemo } from 'react'
import type { Edit } from '@/types/edit'
import { useAllEdits } from './useAllEdits'

const PENDING = ['pending', 'pending_decision']
const HANDLED = ['accepted', 'rejected', 'rolled_back', 'auto_accepted']

export interface NavCounts {
  /** `error` means the count is unknown: show "—", never a number. */
  status: 'loading' | 'ready' | 'error'
  pending: number | null
  history: number | null
  pendingEdits: Edit[]
  historyEdits: Edit[]
}

/**
 * The one rule for the pending count and the handled count: the selected project's changes,
 * from the single ['edits','all'] query. The sidebar, the subtitles and the screens read this
 * hook and never filter the list again.
 */
export function useNavCounts(projectPath: string | null): NavCounts {
  const { data, isError } = useAllEdits()
  return useMemo(() => {
    const inScope = (data ?? []).filter((e) => projectPath === null || e.path.startsWith(projectPath))
    const pendingEdits = inScope.filter((e) => PENDING.includes(e.status))
    const historyEdits = inScope.filter((e) => HANDLED.includes(e.status))
    if (isError) return { status: 'error', pending: null, history: null, pendingEdits, historyEdits }
    if (data === undefined) return { status: 'loading', pending: null, history: null, pendingEdits, historyEdits }
    return { status: 'ready', pending: pendingEdits.length, history: historyEdits.length, pendingEdits, historyEdits }
  }, [data, isError, projectPath])
}
