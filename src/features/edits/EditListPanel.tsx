import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api } from '@/lib/ipc'
import { errorText, shortPath } from '@/lib/format'
import type { Edit, EditStatus } from '@/types/edit'
import { useState, useMemo, useDeferredValue, useEffect, type KeyboardEvent } from 'react'
import { Loader2, Search, FileCode, Inbox, X } from 'lucide-react'
import StatusSlot from '@/components/shell/StatusSlot'
import SourceLabel from '@/components/SourceLabel'
import Banner from '@/components/ui/Banner'
import Button from '@/components/ui/Button'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import IconButton from '@/components/ui/IconButton'
import Input from '@/components/ui/Input'
import ListRow from '@/components/ui/ListRow'
import StatusMark from '@/components/ui/StatusMark'
import VirtualList from '@/components/ui/VirtualList'
import { useAllEdits } from '@/hooks/useAllEdits'
import { useReviewFilterStore } from '@/stores/useReviewFilterStore'

interface Props {
  selectedId: string | null
  /** `null` clears the selection, which happens when a filter hides the selected row. */
  onSelect: (id: string | null) => void
  showHistory?: boolean
  projectPath?: string | null
  /** True while a decision made with A or R is in flight: the list ignores its selection keys until the next change is shown. */
  locked?: boolean
}

const ACTIVE_STATUSES: EditStatus[] = ['pending', 'pending_decision']
const HISTORY_STATUSES: EditStatus[] = ['accepted', 'rejected', 'rolled_back', 'auto_accepted']

// One index refresh at a time and, after a success, at most one per 15 s: Pending and
// History both mount this panel, and the first pass reads the whole session history.
// A failure is kept and stamps nothing, so the next mount reads again at once.
type IndexResult = { ok: true } | { ok: false; error: string }
let inflight: Promise<IndexResult> | null = null
let lastDone = 0
let lastError: string | null = null

/** Index new session history and label recorded changes, then reload the lists. */
function ensureIndexed(qc: QueryClient): Promise<IndexResult> | null {
  if (inflight) return inflight
  if (Date.now() - lastDone < 15_000) return null
  inflight = Promise.resolve(api.sessionsRefresh())
    .then((r): IndexResult => {
      if (r && r.labelled > 0) qc.invalidateQueries({ queryKey: ['edits'] })
      lastDone = Date.now()
      lastError = null
      return { ok: true }
    })
    .catch((e): IndexResult => {
      const error = String((e as Error)?.message ?? e)
      lastError = error
      return { ok: false, error }
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

// eslint-disable-next-line react-refresh/only-export-components -- test hook
export function resetIndexThrottle() {
  inflight = null
  lastDone = 0
  lastError = null
}

export default function EditListPanel({
  selectedId,
  onSelect,
  showHistory = false,
  projectPath,
  locked = false
}: Props) {
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)

  // The one ['edits','all'] query: an edits-changed event refreshes it once for the sidebar, the
  // subtitles and this list together.
  const { data: all, isLoading, isError, error, refetch } = useAllEdits()
  const allowed = showHistory ? HISTORY_STATUSES : ACTIVE_STATUSES
  const edits = useMemo(
    () => (all ?? []).filter((e) => allowed.includes(e.status) && (!projectPath || e.path.startsWith(projectPath))),
    [all, allowed, projectPath]
  )

  const tab = showHistory ? 'history' : 'pending'
  const claudeOnly = useReviewFilterStore((s) => s.claudeOnly[tab])
  const sessionId = useReviewFilterStore((s) => s.sessionId)
  const setClaudeOnly = useReviewFilterStore((s) => s.setClaudeOnly)
  const setSessionId = useReviewFilterStore((s) => s.setSessionId)
  const qc = useQueryClient()
  const [indexing, setIndexing] = useState(false)
  const [indexError, setIndexError] = useState<string | null>(lastError)

  useEffect(() => {
    const p = ensureIndexed(qc)
    if (!p) return
    let live = true
    setIndexing(true)
    void p.then((r) => {
      if (!live) return
      setIndexing(false)
      setIndexError(r.ok ? null : r.error)
    })
    return () => {
      live = false
    }
  }, [qc])

  const searched = useMemo(() => {
    if (!deferredSearch.trim()) return edits
    const q = deferredSearch.toLowerCase()
    return edits.filter((e) => e.path.toLowerCase().includes(q) || e.tool.toLowerCase().includes(q))
  }, [edits, deferredSearch])

  const filtering = claudeOnly || sessionId !== null
  const visible = useMemo(
    () => searched.filter((e) => (!claudeOnly || e.source === 'claude') && (!sessionId || e.session_id === sessionId)),
    [searched, claudeOnly, sessionId]
  )

  // A filter that hides the selected row clears the selection, so the A / R
  // shortcuts never act on a row the user cannot see.
  useEffect(() => {
    if (filtering && !isLoading && selectedId && !visible.some((e) => e.id === selectedId)) {
      onSelect(null)
    }
  }, [filtering, isLoading, selectedId, visible, onSelect])

  // While a key decision is in flight the selection must not move, by j, k or the list's own keys.
  const holdKeys = (e: KeyboardEvent) => {
    if (locked && SELECTION_KEYS.includes(e.key)) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  const searching = !!deferredSearch.trim()
  const narrowed = searching || filtering
  const label = showHistory ? 'Thay đổi đã xử lý' : 'Thay đổi chờ duyệt'

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-0">
      <div className="flex flex-col gap-2 border-b border-line px-3 pb-3 pt-3">
        <Input
          type="search"
          size="md"
          leadingIcon={Search}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm path / tool…"
          aria-label="Tìm path / tool…"
          data-primary-search
        />
        <div className="flex h-7 items-center gap-2">
          <Button size="sm" variant="secondary" pressed={claudeOnly} onClick={() => setClaudeOnly(tab, !claudeOnly)}>
            chỉ thay đổi của Claude
          </Button>
          {sessionId && (
            <span className="inline-flex h-7 min-w-0 items-center rounded-md bg-accent-subtle pl-2 text-xs text-accent-fg">
              <span className="truncate">{`session ${sessionId.slice(0, 8)}`}</span>
              <IconButton size="sm" variant="ghost" icon={X} label="Bỏ lọc session" onClick={() => setSessionId(null)} />
            </span>
          )}
        </div>
      </div>

      <StatusSlot>
        {indexing ? (
          <Banner tone="info" icon={Loader2} spinIcon layout="bleed" role="status">
            Đang lập chỉ mục lịch sử session — nhãn nguồn có thể chưa đủ
          </Banner>
        ) : indexError ? (
          <Banner tone="danger" layout="bleed" role="alert">
            <span
              className="line-clamp-2"
              title={`Không đọc được lịch sử session: ${indexError} — nhãn nguồn có thể chưa đủ. Mở lại tab để thử lại.`}
            >
              {`Không đọc được lịch sử session: ${indexError} — nhãn nguồn có thể chưa đủ. Mở lại tab để thử lại.`}
            </span>
          </Banner>
        ) : (
          <p className="px-3 py-2 text-xs tabular-nums text-ink-muted">
            {isError || isLoading ? '' : narrowed ? `${visible.length} / ${edits.length} mục` : `${visible.length} mục`}
          </p>
        )}
      </StatusSlot>

      <div onKeyDownCapture={holdKeys} className="flex min-h-0 flex-1 flex-col">
        <VirtualList
          items={visible}
          getKey={(e) => e.id}
          itemSize={72}
          ariaLabel={label}
          selectedId={selectedId}
          onSelectId={onSelect}
          loading={isLoading}
          error={
            isError ? (
              <ErrorState title="Không tải được danh sách thay đổi" detail={errorText(error)} onRetry={() => void refetch()} />
            ) : undefined
          }
          empty={<EmptyList search={searching} history={showHistory} filtered={filtering} />}
          renderRow={(edit, { selected }) => <EditRow edit={edit} selected={selected} />}
        />
      </div>
    </div>
  )
}

const SELECTION_KEYS = ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', 'j', 'k']

function EditRow({ edit, selected }: { edit: Edit; selected: boolean }) {
  return (
    <ListRow height="edit" selected={selected}>
      <div className="flex h-5 items-center gap-1.5">
        <FileCode aria-hidden size={14} className="shrink-0 text-ink-muted" />
        <span className="min-w-0 truncate font-mono text-sm font-medium" title={edit.path}>
          {shortPath(edit.path)}
        </span>
      </div>
      <div className="flex h-5 items-center justify-between gap-2 text-xs text-ink-muted">
        <span className="min-w-0 truncate">{`${edit.tool} · ${formatTime(edit.created_at)}`}</span>
        <StatusMark kind="edit" value={edit.status} />
      </div>
      <div className="h-4 truncate text-xs">
        <SourceLabel edit={edit} />
      </div>
    </ListRow>
  )
}

function EmptyList({ search, history, filtered }: { search: boolean; history: boolean; filtered: boolean }) {
  const text = search
    ? { title: 'Không tìm thấy', description: 'Thử từ khoá khác.' }
    : filtered
      ? { title: 'Không có thay đổi nào khớp bộ lọc', description: 'Tắt bộ lọc để xem tất cả.' }
      : history
        ? { title: 'Chưa có thay đổi nào đã xử lý', description: 'Thay đổi đã chấp nhận hoặc từ chối sẽ hiện ở đây.' }
        : { title: 'Không còn thay đổi nào chờ duyệt', description: 'Thay đổi Claude tạo ra sẽ hiện ở đây ngay khi xảy ra.' }
  return <EmptyState icon={Inbox} {...text} />
}

function formatTime(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('vi-VN', { month: 'short', day: 'numeric' })
}
