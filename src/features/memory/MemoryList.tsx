import { AlertCircle, AlertTriangle, Inbox, Loader2, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import StatusSlot from '@/components/shell/StatusSlot'
import Banner from '@/components/ui/Banner'
import Button from '@/components/ui/Button'
import EmptyState from '@/components/ui/EmptyState'
import Input from '@/components/ui/Input'
import ListRow from '@/components/ui/ListRow'
import Segmented from '@/components/ui/Segmented'
import StatusMark from '@/components/ui/StatusMark'
import VirtualList from '@/components/ui/VirtualList'
import type { Mem0Status, MemoryEntry, MemoryKind, MemoryProblem } from '@/types/memory'

export type KindFilter = 'all' | MemoryKind

/** The approved sentence for each reason mem0 is unavailable. */
function reasonText(m: Mem0Status): string | null {
  if (m.state !== 'unavailable') return null
  const code = m.status ?? ''
  switch (m.reason) {
    case 'no_key':
      return 'Chưa nhập mem0 API key — mở Cài đặt để nhập.'
    case 'connection':
      return 'Không kết nối được tới mem0. Kiểm tra mạng rồi mở lại màn này.'
    case 'timeout':
      return 'mem0 không trả lời sau 15 giây.'
    case 'auth_401_403':
      return `mem0 từ chối key (mã ${code}). Kiểm tra lại key trong Cài đặt.`
    case 'http_other':
      return `mem0 báo lỗi (mã ${code}).`
    case 'bad_reply':
      return 'mem0 trả về dữ liệu không đọc được.'
  }
}

// eslint-disable-next-line react-refresh/only-export-components -- shared with the detail pane
export function sourceText(e: MemoryEntry): string {
  return 'path' in e.source ? `${e.source.path}:${e.source.line}` : `mem0 · ${e.source.mem0_id}`
}

interface Props {
  entries: MemoryEntry[]
  /** Files the backend could not read; shown above the entries, never filtered and never selectable. */
  problems: MemoryProblem[]
  mem0: Mem0Status
  loading: boolean
  scoped: boolean
  selectedId: string | null
  onSelect: (id: string | null) => void
  onOpenSettings?: () => void
}

const KINDS: { value: KindFilter; label: string }[] = [
  { value: 'all', label: 'Tất cả' },
  { value: 'memory', label: 'Memory' },
  { value: 'error', label: 'Lỗi' },
]

export default function MemoryList({ entries, problems, mem0, loading, scoped, selectedId, onSelect, onOpenSettings }: Props) {
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState<KindFilter>('all')

  // Local entries first, mem0 after them: a row already shown does not jump when mem0 answers late.
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    const hit = entries.filter((e) => (kind === 'all' || e.kind === kind) && (!q || e.text.toLowerCase().includes(q)))
    return [...hit.filter((e) => 'path' in e.source), ...hit.filter((e) => !('path' in e.source))]
  }, [entries, kind, search])

  const reason = reasonText(mem0)
  const mem0Count = entries.filter((e) => !('path' in e.source)).length
  const narrowing = search.trim() !== '' || kind !== 'all'

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-0">
      <div className="flex flex-col gap-2 border-b border-line px-3 pb-3 pt-3">
        <Input
          type="search"
          leadingIcon={Search}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm trong memory và lỗi…"
          aria-label="Tìm trong memory và lỗi…"
          data-primary-search
        />
        <Segmented aria-label="Loại" value={kind} onChange={setKind} options={KINDS} />
      </div>

      <StatusSlot>
        {!scoped && loading ? (
          <Banner tone="neutral" icon={Loader2} spinIcon layout="bleed" role="status">
            Đang tải mem0…
          </Banner>
        ) : !scoped && reason ? (
          <Banner
            tone="warning"
            icon={AlertTriangle}
            layout="bleed"
            role="status"
            actions={
              mem0.state === 'unavailable' && mem0.reason === 'no_key' && onOpenSettings ? (
                <Button size="sm" variant="ghost" onClick={onOpenSettings}>
                  Cài đặt
                </Button>
              ) : undefined
            }
          >
            <span className="line-clamp-3" title={`mem0 không khả dụng: ${reason}`}>{`mem0 không khả dụng: ${reason}`}</span>
          </Banner>
        ) : (
          <div className="px-3 py-2">
            <p className="text-xs tabular-nums text-ink-muted">{loading ? '' : `${shown.length} mục`}</p>
            {scoped && <p className="text-xs text-ink-muted">mem0 và memory toàn cục chỉ hiện ở “Tất cả”.</p>}
            {!scoped && !loading && mem0Count === 0 && <p className="text-xs text-ink-muted">mem0 chưa có mục nào</p>}
          </div>
        )}
      </StatusSlot>

      {problems.length > 0 && (
        <ul className="max-h-memory-problems shrink-0 overflow-y-auto">
          {problems.map((p) => (
            <li key={p.path} className="flex h-row-memory flex-col justify-center border-b border-line px-3">
              <div className="flex h-5 items-center gap-1.5 text-danger-fg">
                <AlertCircle aria-hidden size={14} className="shrink-0" />
                <span className="min-w-0 truncate text-sm">{`Không đọc được: ${p.error}`}</span>
              </div>
              <div className="h-4 truncate font-mono text-xs text-ink-muted" title={p.path}>
                {p.path}
              </div>
            </li>
          ))}
        </ul>
      )}

      <VirtualList
        items={shown}
        getKey={(e) => e.id}
        itemSize={56}
        ariaLabel="Memory và lỗi"
        selectedId={selectedId}
        onSelectId={onSelect}
        loading={loading && entries.length === 0}
        empty={
          narrowing && entries.length > 0 ? (
            <EmptyState icon={Search} title="Không tìm thấy" description="Thử từ khoá khác." />
          ) : (
            <EmptyState icon={Inbox} title="Chưa có memory hay lỗi nào" description="Mục sẽ hiện khi project có file memory hoặc errors.yaml." />
          )
        }
        renderRow={(e, { selected }) => <MemoryRow entry={e} selected={selected} />}
      />
    </div>
  )
}

function MemoryRow({ entry: e, selected }: { entry: MemoryEntry; selected: boolean }) {
  return (
    <ListRow height="memory" selected={selected}>
      <div className="flex h-5 items-center gap-2">
        <StatusMark kind="memory" value={e.kind} />
        <span className="min-w-0 flex-1 truncate text-sm">{e.text.split('\n')[0]}</span>
      </div>
      <div className="flex h-4 items-center gap-2 text-xs">
        <span className="min-w-0 flex-1 truncate font-mono text-ink-muted" title={sourceText(e)}>
          {sourceText(e)}
        </span>
        {e.project && <span className="max-w-[96px] shrink-0 truncate text-ink-subtle">{e.project}</span>}
      </div>
    </ListRow>
  )
}
