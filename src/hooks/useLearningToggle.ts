import { useCallback, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/ipc'
import { useLearningStore } from '@/stores/useLearningStore'

// Learning mode — flip it, and keep the renderer's copy honest (W6-T6a
// plus the ownership follow-up).
//
// Ownership: the SQLite settings row is the source of truth, because the
// consumers live outside the renderer — `explain::instructions` adds the
// "Học được gì" section to the Anthropic prompt, and `claude-manager
// status` prints the flag. The Zustand store is a warm-start cache so the
// header button does not flash off before settings load.
//
// No loop is possible: nothing here listens to `learning-changed`. The
// event is for consumers in other windows/processes; a listener writing
// back into the store would ping-pong.

/**
 * Flip learning mode. Writes the store immediately (the button must feel
 * instant), then persists + broadcasts. On failure the store is left
 * alone — `useLearningSync` pulls the real value back on the next
 * settings read, so the UI self-heals instead of guessing.
 */
export function useLearningToggle(): {
  enabled: boolean
  toggle: () => void
} {
  const enabled = useLearningStore((s) => s.enabled)
  const toggle = useLearningStore((s) => s.toggle)
  const qc = useQueryClient()

  const run = useCallback(() => {
    const next = !useLearningStore.getState().enabled
    toggle()
    api
      .settingsLearningToggle(next)
      // Refresh the settings cache so every other reader (and the sync
      // effect below) sees the stored value rather than the stale one.
      .then(() => qc.invalidateQueries({ queryKey: ['settings'] }))
      .catch((e) => console.warn('learning toggle failed:', e))
  }, [toggle, qc])

  return { enabled, toggle: run }
}

/**
 * Reconcile the cached flag with the DB. Mounted once in App: whenever
 * settings load or refetch, the store follows. This is what makes a
 * failed toggle, an edit from another window, or a hand-edited DB row
 * converge instead of drifting.
 */
export function useLearningSync(): void {
  const { data } = useQuery({
    queryKey: ['settings'],
    queryFn: api.getSettings,
    staleTime: 5000,
  })
  const setEnabled = useLearningStore((s) => s.setEnabled)

  useEffect(() => {
    if (!data) return
    // Compare against the live store value, not a subscribed one, so this
    // effect does not re-run on every unrelated toggle.
    if (data.learning !== useLearningStore.getState().enabled) {
      setEnabled(data.learning)
    }
  }, [data, setEnabled])
}
