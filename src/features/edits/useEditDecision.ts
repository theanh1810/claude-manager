import { useIsMutating, useMutation, useMutationState, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/ipc'
import { errorText } from '@/lib/format'
import { useConfirm } from '@/components/ui/ConfirmProvider'

/** The same code as LEGACY_CONFIRM in src-tauri/src/rollback.rs; the backend error is matched by equality. */
export const LEGACY_CONFIRM_CODE = 'LEGACY_CONFIRM'

/** The description of the dialog shown when the backend answers LEGACY_CONFIRM_CODE. */
export const LEGACY_CONFIRM_TEXT =
  'Thay đổi cũ, không rõ file có bị sửa thêm sau đó không. Vẫn khôi phục về bản trước?'

/** Per-call callbacks: onDone after the refresh resolved and the next change was chosen; onError on failure. */
export interface DecisionCallbacks {
  onDone?: () => void
  onError?: () => void
}

export type DecisionKind = 'accept' | 'reject' | 'rollback'

export { errorText }

type Confirm = ReturnType<typeof useConfirm>

/**
 * Calls once without confirmation. A legacy row makes the backend answer LEGACY_CONFIRM_CODE: ask the
 * user in the app dialog, and on confirm call again with confirmLegacy true. Resolves false when the
 * user cancels.
 */
async function withLegacyConfirm(confirm: Confirm, call: (confirmLegacy: boolean) => Promise<void>): Promise<boolean> {
  try {
    await call(false)
    return true
  } catch (e) {
    if (errorText(e) !== LEGACY_CONFIRM_CODE) throw e
  }
  const ok = await confirm({
    tone: 'danger',
    title: 'Khôi phục thay đổi cũ?',
    description: LEGACY_CONFIRM_TEXT,
    confirmLabel: 'Vẫn khôi phục'
  })
  if (!ok) return false
  await call(true)
  return true
}

/** One decision path for the buttons and the keyboard; each mutation is keyed ['decision', id, kind]. */
export function useEditDecision(id: string | null, onAfterDecision?: () => void) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['edits'] }),
      qc.invalidateQueries({ queryKey: ['edit', id] })
    ])
  const accept = useMutation({
    mutationKey: ['decision', id, 'accept'],
    mutationFn: () => api.acceptEdit(id!),
    onSuccess: async () => {
      const refreshed = refresh()
      onAfterDecision?.()
      await refreshed
    }
  })
  const reject = useMutation({
    mutationKey: ['decision', id, 'reject'],
    mutationFn: () => withLegacyConfirm(confirm, (confirmLegacy) => api.rejectEdit(id!, confirmLegacy)),
    onSuccess: async (done) => {
      if (!done) return
      const refreshed = refresh()
      onAfterDecision?.()
      await refreshed
    }
  })
  // Rollback keeps today's behaviour: it refreshes but does not advance to the next change.
  const rollback = useMutation({
    mutationKey: ['decision', id, 'rollback'],
    mutationFn: () => withLegacyConfirm(confirm, (confirmLegacy) => api.rollbackEdit(id!, confirmLegacy)),
    onSuccess: async (done) => {
      if (done) await refresh()
    }
  })
  const busy = useIsMutating({ mutationKey: ['decision', id] }) > 0
  return {
    accept: (cb?: DecisionCallbacks) => {
      // mutateAsync, not per-call mutate callbacks: those are dropped once the mutationKey changes after the advance.
      if (id) void accept.mutateAsync().then(() => cb?.onDone?.(), () => cb?.onError?.())
    },
    reject: (cb?: DecisionCallbacks) => {
      if (id) void reject.mutateAsync().then(() => cb?.onDone?.(), () => cb?.onError?.())
    },
    // The question comes first, so a cancel starts nothing and the button never shows a pending state for it.
    rollback: async () => {
      if (!id) return
      const ok = await confirm({
        tone: 'danger',
        title: 'Hoàn tác thay đổi đã chấp nhận?',
        description: 'File hiện tại sẽ được đưa về nội dung trước thay đổi. App giữ một bản sao nội dung hiện tại.',
        confirmLabel: 'Hoàn tác'
      })
      if (ok) rollback.mutate()
    },
    busy
  }
}

/** What the detail panel shows for one change: the decision in flight, and the newest error not yet followed by a success. */
export function useDecisionStatus(id: string | null): { pending: DecisionKind | null; error: string | null } {
  const mutationKey = ['decision', id]
  const pending = useMutationState({
    filters: { mutationKey, status: 'pending' },
    select: (m) => m.options.mutationKey?.[2] as DecisionKind
  })
  const failed = useMutationState({
    filters: { mutationKey, status: 'error' },
    select: (m) => ({ at: m.state.submittedAt, text: errorText(m.state.error) })
  })
  const succeeded = useMutationState({
    filters: { mutationKey, status: 'success' },
    select: (m) => m.state.submittedAt
  })
  const lastFailure = failed.reduce<{ at: number; text: string } | null>(
    (latest, f) => (latest === null || f.at > latest.at ? f : latest),
    null
  )
  const lastSuccess = succeeded.reduce((latest, at) => Math.max(latest, at), 0)
  return {
    pending: pending[0] ?? null,
    error: lastFailure && lastFailure.at > lastSuccess ? lastFailure.text : null
  }
}
