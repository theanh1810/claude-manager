import { useQuery, useQueryClient } from '@tanstack/react-query'
import { listen } from '@tauri-apps/api/event'
import { AlertTriangle, Check, Copy, Loader2, Trash2, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import StatusSlot from '@/components/shell/StatusSlot'
import { formatBytes } from '@/lib/bytes'
import Banner from '@/components/ui/Banner'
import Button from '@/components/ui/Button'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import IconButton from '@/components/ui/IconButton'
import ListRow from '@/components/ui/ListRow'
import ProgressBar from '@/components/ui/ProgressBar'
import VirtualList from '@/components/ui/VirtualList'
import { useAllEdits } from '@/hooks/useAllEdits'
import { errorText } from '@/lib/format'
import { api } from '@/lib/ipc'
import { useNoticeStore } from '@/stores/useNoticeStore'
import { useReviewFilterStore } from '@/stores/useReviewFilterStore'
import type { SessionSummary } from '@/types/session'

interface Props {
  /** Open Pending (when the session has a pending change) or History, filtered to the session. */
  onNavigate?: (sessionId: string, hasPending: boolean) => void
  /** Path of the selected project; null or absent is every project. */
  project?: string | null
}

interface Progress {
  done: number
  total: number
}

/** One line of the flat list: a project header or one of its sessions. */
type Row =
  | { kind: 'group'; key: string; dir: string; count: number; size: number }
  | { kind: 'session'; key: string; session: SessionSummary }

const GROUP_H = 36
const SESSION_H = 64
const SESSION_WARN_H = 84
const TRASH_NOTICE = 'sessions-trash'

function when(sec: number) {
  return new Date(sec * 1000).toLocaleString('vi-VN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function gb(n: number) {
  return (n / 1024 ** 3).toFixed(2).replace('.', ',')
}

/** What names a session's project: its registered path, else the transcript folder as stored. */
function projectLabel(s: SessionSummary): string {
  return s.project_dir ?? s.project_folder
}

/** The resume command; without a registered directory there is nothing to cd into. */
function resumeCommand(s: SessionSummary): string {
  return s.project_dir ? `cd "${s.project_dir}" && claude --resume ${s.id}` : `claude --resume ${s.id}`
}

export default function SessionsPage({ onNavigate, project = null }: Props) {
  const qc = useQueryClient()
  const [progress, setProgress] = useState<Progress | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<SessionSummary | null>(null)
  const [trashing, setTrashing] = useState(false)
  const [trashFailed, setTrashFailed] = useState(false)
  const setSessionId = useReviewFilterStore((s) => s.setSessionId)
  const notify = useNoticeStore((s) => s.notify)
  const dismiss = useNoticeStore((s) => s.dismiss)
  const { data: edits = [] } = useAllEdits()

  const index = useQuery({ queryKey: ['sessions-index'], queryFn: api.sessionsRefresh, staleTime: 15_000 })
  const {
    data: sessions = [],
    isLoading,
    isError,
    error,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ['sessions', project],
    queryFn: () => api.sessionsList(project),
    // Show sessions as soon as they are indexed, not only when the pass ends.
    refetchInterval: index.isFetching ? 2_000 : false,
  })

  useEffect(() => {
    const un = listen<Progress>('sessions-index-progress', (e) => setProgress(e.payload))
    return () => {
      void un.then((f) => f())
    }
  }, [])
  useEffect(() => {
    if (index.data) {
      setProgress(null)
      void qc.invalidateQueries({ queryKey: ['sessions'] })
    }
  }, [index.data, qc])

  const rows = useMemo<Row[]>(() => {
    const m = new Map<string, SessionSummary[]>()
    for (const s of sessions) {
      const key = projectLabel(s)
      m.set(key, [...(m.get(key) ?? []), s])
    }
    return Array.from(m.entries()).flatMap(([dir, list], g): Row[] => [
      { kind: 'group', key: `group-${g}`, dir, count: list.length, size: list.reduce((a, s) => a + s.size, 0) },
      ...list.map((session): Row => ({ kind: 'session', key: session.id, session })),
    ])
  }, [sessions])

  const pendingOf = (id: string) =>
    edits.some((e) => e.session_id === id && (e.status === 'pending' || e.status === 'pending_decision'))

  const copy = async (s: SessionSummary) => {
    await navigator.clipboard.writeText(resumeCommand(s))
    setCopied(s.id)
    window.setTimeout(() => setCopied((c) => (c === s.id ? null : c)), 2000)
  }

  const trash = async () => {
    if (!confirm) return
    setTrashing(true)
    setTrashFailed(false)
    try {
      const res = await api.sessionTrash(confirm.id)
      const failed = res.filter((r) => !r.ok)
      if (failed.length > 0) {
        notify({
          id: TRASH_NOTICE,
          tone: 'warning',
          children: (
            <>
              {failed.length} mục không chuyển được
              <ul>
                {failed.map((r) => (
                  <li key={r.path} className="truncate font-mono text-xs" title={r.path}>
                    {r.path}: {r.error}
                  </li>
                ))}
              </ul>
            </>
          ),
        })
      } else dismiss(TRASH_NOTICE)
      setConfirm(null)
      await qc.invalidateQueries({ queryKey: ['sessions'] })
    } catch (e) {
      // The command itself failed: say so inside the dialog, keep it open to try again.
      setTrashFailed(true)
      throw e
    } finally {
      setTrashing(false)
    }
  }

  const pct = progress && progress.total > 0 ? Math.floor((progress.done / progress.total) * 100) : 0
  const skipped = index.data?.malformed_lines ?? 0
  const totalSize = sessions.reduce((a, s) => a + s.size, 0)

  return (
    <div className="flex h-full min-h-0 w-full max-w-[960px] flex-col bg-surface-0">
      <StatusSlot>
        {progress ? (
          <Banner tone="info" icon={Loader2} spinIcon layout="bleed">
            <div className="flex justify-between gap-3">
              <span>Đang lập chỉ mục lịch sử session… {pct}%</span>
              <span className="tabular-nums">
                {gb(progress.done)} / {gb(progress.total)} GB
              </span>
            </div>
            <div className="mt-1">
              <ProgressBar value={pct} max={100} label="Đang lập chỉ mục lịch sử session" tone="accent" size="sm" animated />
            </div>
          </Banner>
        ) : (
          <div className="px-4 py-2">
            <p className="text-xs tabular-nums text-ink-muted">
              {isLoading || isError ? '' : `${sessions.length} session · ${formatBytes(totalSize)}`}
            </p>
            {skipped > 0 && <p className="text-xs text-ink-muted">Bỏ qua {skipped} dòng không đọc được</p>}
          </div>
        )}
      </StatusSlot>

      <VirtualList
        items={rows}
        getKey={(r) => r.key}
        itemSize={(i) => (rows[i]?.kind === 'group' ? GROUP_H : rows[i]?.kind === 'session' && !rows[i].session.project_dir ? SESSION_WARN_H : SESSION_H)}
        ariaLabel="Sessions theo project"
        selectable={false}
        loading={isLoading}
        error={
          isError ? (
            <ErrorState title="Lỗi tải sessions." detail={errorText(error)} onRetry={() => void refetch()} retrying={isRefetching} />
          ) : undefined
        }
        empty={<EmptyState icon={Users} title="Chưa có session nào." />}
        renderRow={(r) =>
          r.kind === 'group' ? (
            <div className="bg-surface-1">
              <ListRow height="group">
                <div className="flex h-5 items-center justify-between gap-3 px-1">
                  <h2 className="m-0 min-w-0 truncate text-sm font-semibold" title={r.dir}>
                    {r.dir}
                  </h2>
                  <span className="shrink-0 text-xs tabular-nums text-ink-muted">
                    {r.count} session · {formatBytes(r.size)}
                  </span>
                </div>
              </ListRow>
            </div>
          ) : (
            <SessionRow
              session={r.session}
              copied={copied === r.session.id}
              onView={() => {
                setSessionId(r.session.id)
                onNavigate?.(r.session.id, pendingOf(r.session.id))
              }}
              onCopy={() => void copy(r.session)}
              onTrash={() => {
                setTrashFailed(false)
                setConfirm(r.session)
              }}
            />
          )
        }
      />
      <p aria-live="polite" className="sr-only">
        {copied ? 'Đã chép' : ''}
      </p>

      {confirm && (
        <ConfirmDialog
          tone="danger"
          title="Chuyển session vào Thùng rác?"
          description={`Tổng ${formatBytes(confirm.size)}. Khôi phục được từ Thùng rác.`}
          confirmLabel="Chuyển vào Thùng rác"
          busy={trashing}
          error={trashFailed ? '1 mục không chuyển được' : undefined}
          onConfirm={trash}
          onCancel={() => setConfirm(null)}
          details={
            <div className="flex flex-col gap-3">
              <Banner tone="warning" layout="inline">
                Sau khi chuyển, lệnh resume của session này không còn dùng được.
              </Banner>
              <ul className="max-h-64 divide-y divide-line overflow-y-auto text-xs">
                <li className="flex justify-between gap-3 py-1.5">
                  <span className="truncate font-mono" title={`${confirm.id.slice(0, 8)} · ${projectLabel(confirm)}`}>
                    {confirm.id.slice(0, 8)} · {projectLabel(confirm)}
                  </span>
                  <span className="shrink-0 tabular-nums">{formatBytes(confirm.size)}</span>
                </li>
              </ul>
            </div>
          }
        />
      )}
    </div>
  )
}

interface SessionRowProps {
  session: SessionSummary
  copied: boolean
  onView: () => void
  onCopy: () => void
  onTrash: () => void
}

function SessionRow({ session: s, copied, onView, onCopy, onTrash }: SessionRowProps) {
  return (
    <ListRow height={s.project_dir ? 'session' : 'session-warn'}>
      <div className="flex h-full items-center gap-4">
        <div className="min-w-0 flex-1">
          <code className="block h-5 truncate font-mono text-sm font-medium" title={s.id}>
            {s.id.slice(0, 8)}
          </code>
          <span className="block h-4 truncate text-xs text-ink-muted">
            {when(s.created)} → {when(s.modified)} · {formatBytes(s.size)}
          </span>
          {!s.project_dir && (
            <span className="flex h-4 items-center gap-1 text-xs text-warning-fg">
              <AlertTriangle aria-hidden size={12} className="shrink-0" />
              <span className="truncate">Không rõ thư mục project — cd vào đúng thư mục trước khi chạy.</span>
            </span>
          )}
        </div>
        <div className="flex w-[168px] shrink-0 flex-col text-xs tabular-nums">
          <span>{s.change_count} thay đổi</span>
          <span className={s.reject_count > 0 ? 'font-medium text-danger-fg' : 'text-ink-muted'}>{s.reject_count} từ chối</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" size="sm" disabled={s.change_count === 0} onClick={onView}>
            Xem thay đổi
          </Button>
          <Button variant="secondary" size="sm" icon={copied ? Check : Copy} className="min-w-[148px]" onClick={onCopy}>
            {copied ? 'Đã chép' : 'Chép lệnh resume'}
          </Button>
          <IconButton size="sm" variant="danger-ghost" icon={Trash2} label="Chuyển vào Thùng rác" onClick={onTrash} />
        </div>
      </div>
    </ListRow>
  )
}
