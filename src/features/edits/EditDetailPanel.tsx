import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Check, ChevronDown, FileCode, Sparkles, Undo2, X } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import SourceLabel from '@/components/SourceLabel'
import Button from '@/components/ui/Button'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import Skeleton from '@/components/ui/Skeleton'
import StatusMark from '@/components/ui/StatusMark'
import { useAllEdits } from '@/hooks/useAllEdits'
import { useDelayedFlag } from '@/hooks/useDelayedFlag'
import { errorText } from '@/lib/format'
import { api } from '@/lib/ipc'
import { countLineChanges } from '@/lib/lineStats'
import { useNoticeStore } from '@/stores/useNoticeStore'
import ExplainPanel from './ExplainPanel'
import { useEditDecision, useDecisionStatus } from './useEditDecision'

// The diff viewer is the heaviest part of this screen and is not needed until a change is open.
const DiffView = lazy(() => import('@/components/DiffView'))

interface Props {
  editId: string | null
  onAfterDecision?: () => void
  /** Show the A and R key chips: only the Chờ duyệt screen binds those keys. */
  decisionKeys?: boolean
  /** Opens Settings from the explain panel's error state. */
  onOpenSettings?: () => void
}

const SEPARATOR = (
  <span aria-hidden className="text-ink-subtle">
    ·
  </span>
)

export default function EditDetailPanel({ editId, onAfterDecision, decisionKeys = false, onOpenSettings }: Props) {
  const [explainOpen, setExplainOpen] = useState(false)
  const notify = useNoticeStore((s) => s.notify)
  const dismiss = useNoticeStore((s) => s.dismiss)

  const editQuery = useQuery({
    queryKey: ['edit', editId],
    queryFn: () => api.getEdit(editId!),
    enabled: !!editId,
    placeholderData: keepPreviousData,
    staleTime: 2000
  })
  const diffQuery = useQuery({
    queryKey: ['edit-diff', editId],
    queryFn: () => api.getEditDiff(editId!),
    enabled: !!editId,
    placeholderData: keepPreviousData,
    staleTime: 2000
  })
  const { data: edit } = editQuery
  const { data: diff } = diffQuery

  // get_edit returns the bare row; the source label lives on the labelled list.
  const { data: all } = useAllEdits()
  const labelled = all?.find((e) => e.id === editId)

  const decision = useEditDecision(editId, onAfterDecision)
  const { pending: pendingKind, error: decisionError } = useDecisionStatus(editId)

  const counts = useMemo(() => (diff ? countLineChanges(diff.before, diff.after) : { added: 0, removed: 0 }), [diff])

  // A decision error is a notice of its own; it closes when the next decision starts, when the user
  // hides it, or when another change is selected.
  const shownError = pendingKind === null ? decisionError : null
  useEffect(() => {
    if (!editId || !shownError) return
    const id = `decision-error:${editId}`
    notify({ id, tone: 'danger', children: shownError })
    return () => dismiss(id)
  }, [editId, shownError, notify, dismiss])

  useEffect(() => {
    setExplainOpen(false)
  }, [editId])

  const loading = !!editId && !editQuery.isError && !diffQuery.isError && (!edit || !diff || editQuery.isPlaceholderData || diffQuery.isPlaceholderData)
  // Fast loads keep what is on screen; only a slow one swaps in the skeleton.
  const showSkeleton = useDelayedFlag(loading)

  const retry = () => {
    void editQuery.refetch()
    void diffQuery.refetch()
  }

  if (!editId) {
    return (
      <EmptyState
        icon={FileCode}
        title="Chọn một thay đổi để xem chi tiết"
        description="Chọn một dòng ở danh sách bên trái, rồi chấp nhận, từ chối, hoàn tác hoặc xem giải thích."
      />
    )
  }
  if (editQuery.isError && !edit) {
    return <ErrorState title="Không tải được nội dung thay đổi" detail={errorText(editQuery.error)} onRetry={retry} />
  }
  if (showSkeleton) return <DetailSkeleton />
  if (!edit) return <div aria-busy="true" className="h-full" />

  const stale = edit.id !== editId // the previous change stays on screen for a moment while this one loads
  const pendingStatus = edit.status === 'pending' || edit.status === 'pending_decision'
  const canRollback = edit.status === 'accepted' || edit.status === 'auto_accepted'
  const busy = decision.busy || stale || loading
  const decideTitle = pendingStatus ? undefined : 'Chỉ áp dụng cho thay đổi đang chờ duyệt'

  return (
    <div aria-busy={loading || undefined} className="flex h-full min-w-0 flex-col">
      <header className="flex h-detail-head shrink-0 flex-col border-b border-line bg-surface-1 px-4 py-3">
        <div className="flex h-5 items-center gap-2">
          <FileCode aria-hidden size={14} className="shrink-0 text-ink-muted" />
          <code title={edit.path} className="min-w-0 flex-1 truncate font-mono text-sm font-semibold">
            {edit.path}
          </code>
          <StatusMark kind="edit" value={edit.status} />
        </div>
        <div className="mt-1 flex h-4 items-center gap-2 whitespace-nowrap text-xs text-ink-muted">
          <span>{new Date(edit.created_at).toLocaleString('vi-VN')}</span>
          {SEPARATOR}
          <span>{edit.tool}</span>
          {SEPARATOR}
          <span className="min-w-0 truncate">
            <SourceLabel edit={labelled ?? edit} />
          </span>
          {SEPARATOR}
          <span className="tabular-nums text-success-fg">{`+${counts.added}`}</span>
          <span className="tabular-nums text-danger-fg">{`-${counts.removed}`}</span>
        </div>
        <div className="mt-3 flex h-8 items-center gap-2">
          <Button
            variant="success"
            icon={Check}
            kbd={decisionKeys ? 'A' : undefined}
            aria-label={decisionKeys ? 'Chấp nhận' : undefined}
            aria-keyshortcuts={decisionKeys ? 'A' : undefined}
            loading={pendingKind === 'accept'}
            disabled={!pendingStatus || busy}
            title={decideTitle}
            onClick={() => decision.accept()}
          >
            Chấp nhận
          </Button>
          <Button
            variant="danger-subtle"
            icon={X}
            kbd={decisionKeys ? 'R' : undefined}
            aria-label={decisionKeys ? 'Từ chối' : undefined}
            aria-keyshortcuts={decisionKeys ? 'R' : undefined}
            loading={pendingKind === 'reject'}
            disabled={!pendingStatus || busy}
            title={decideTitle}
            onClick={() => decision.reject()}
          >
            Từ chối
          </Button>
          <Button
            variant="warning"
            icon={Undo2}
            loading={pendingKind === 'rollback'}
            disabled={!canRollback || busy}
            title={canRollback ? undefined : 'Chỉ hoàn tác được thay đổi đã chấp nhận'}
            onClick={() => void decision.rollback()}
          >
            Hoàn tác
          </Button>
          <div className="flex-1" />
          <Button
            variant="accent-subtle"
            icon={Sparkles}
            aria-expanded={explainOpen}
            aria-controls="explain-panel"
            onClick={() => setExplainOpen((v) => !v)}
          >
            {explainOpen ? 'Ẩn giải thích' : 'Giải thích'}
            <ChevronDown aria-hidden size={14} className={`transition-transform duration-fast ${explainOpen ? 'rotate-180' : ''}`} />
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1">
        {diffQuery.isError ? (
          <ErrorState title="Không tải được nội dung thay đổi" detail={errorText(diffQuery.error)} onRetry={retry} />
        ) : !diff ? (
          <DiffFallback />
        ) : diff.before === diff.after ? (
          <EmptyState icon={FileCode} variant="inline" title="Không có dòng nào thay đổi" />
        ) : (
          <Suspense fallback={<DiffFallback />}>
            <DiffView before={diff.before} after={diff.after} />
          </Suspense>
        )}
      </div>

      {explainOpen && <ExplainPanel editId={edit.id} cached={edit.explanation_md} onClose={() => setExplainOpen(false)} onOpenSettings={onOpenSettings} />}
    </div>
  )
}

function DiffFallback() {
  return (
    <div className="p-3">
      <Skeleton.Block height={320} />
    </div>
  )
}

/** The loaded layout at its real sizes: the header block, the diff bar and a diff that fills the rest. */
function DetailSkeleton() {
  return (
    <div className="flex h-full flex-col">
      <div className="h-detail-head shrink-0 border-b border-line bg-surface-1 px-4 py-3">
        <Skeleton.Block height={84} />
      </div>
      <div className="h-diff-bar shrink-0 border-b border-line bg-surface-1" />
      <DiffFallback />
    </div>
  )
}
