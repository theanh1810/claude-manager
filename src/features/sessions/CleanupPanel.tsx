import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { formatBytes } from '@/lib/bytes'
import Button from '@/components/ui/Button'
import Checkbox from '@/components/ui/Checkbox'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import Disclosure from '@/components/ui/Disclosure'
import ErrorState from '@/components/ui/ErrorState'
import Segmented from '@/components/ui/Segmented'
import Skeleton from '@/components/ui/Skeleton'
import { errorText } from '@/lib/format'
import { api } from '@/lib/ipc'
import { useNoticeStore } from '@/stores/useNoticeStore'
import type { CleanupEntry, CleanupReason, TrashResult } from '@/types/session'

type Cutoff = '7' | '30' | '90'
type GroupKey = 'redundant' | 'aged' | 'never_touch'

const CUTOFFS: { value: Cutoff; label: string }[] = [
  { value: '7', label: '7 ngày' },
  { value: '30', label: '30 ngày' },
  { value: '90', label: '90 ngày' },
]

const TITLE: Record<GroupKey, string> = {
  redundant: 'Rõ ràng thừa',
  aged: 'Claude Code tạo ra — dọn theo tuổi',
  never_touch: 'Không đụng tới',
}

const REASON: Record<CleanupReason, string> = {
  config: 'cấu hình / ruleset',
  kept_list: 'trong danh sách giữ',
  credential: 'giống credential',
  unclassified: 'cấu hình / ruleset',
}

const RESULT_NOTICE = 'cleanup-result'

/** `~/.claude/projects/-p/x.jsonl` shows as `projects/-p/x.jsonl`. */
function shortName(path: string) {
  const i = path.indexOf('/.claude/')
  return i >= 0 ? path.slice(i + '/.claude/'.length) : path
}

function day(sec: number) {
  return new Date(sec * 1000).toLocaleDateString('vi-VN')
}

const sumSize = (list: CleanupEntry[]) => list.reduce((s, e) => s + e.size, 0)

export default function CleanupPanel() {
  const qc = useQueryClient()
  const notify = useNoticeStore((s) => s.notify)
  const dismiss = useNoticeStore((s) => s.dismiss)
  const [cutoff, setCutoff] = useState<Cutoff>('30')
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [rejected, setRejected] = useState<number | null>(null)

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ['cleanup', Number(cutoff)],
    queryFn: () => api.cleanupScan(Number(cutoff)),
    staleTime: 0,
  })

  const offered = useMemo(() => {
    const m = new Map<string, CleanupEntry>()
    for (const e of [...(data?.groups.redundant ?? []), ...(data?.groups.aged ?? [])]) m.set(e.path, e)
    return m
  }, [data])
  const chosen = [...ticked].map((p) => offered.get(p)).filter((e): e is CleanupEntry => !!e)
  const total = sumSize(chosen)

  // A rescan that drops every ticked item hides the dialog; the flag must not outlive it, or the next tick would reopen it.
  const selectionEmpty = chosen.length === 0
  useEffect(() => {
    if (confirming && selectionEmpty && !busy) setConfirming(false)
  }, [confirming, selectionEmpty, busy])

  const toggle = (path: string) =>
    setTicked((s) => {
      const n = new Set(s)
      if (n.has(path)) n.delete(path)
      else n.add(path)
      return n
    })
  const toggleAll = (list: CleanupEntry[]) =>
    setTicked((s) => {
      const n = new Set(s)
      const all = list.every((e) => n.has(e.path))
      list.forEach((e) => (all ? n.delete(e.path) : n.add(e.path)))
      return n
    })

  const changeCutoff = (c: Cutoff) => {
    setCutoff(c)
    setTicked(new Set())
    setRejected(null)
    dismiss(RESULT_NOTICE)
  }

  const showResult = (results: TrashResult[]) => {
    const moved = results.filter((r) => r.ok)
    const failed = results.filter((r) => !r.ok)
    notify({
      id: RESULT_NOTICE,
      tone: failed.length > 0 ? 'warning' : 'success',
      children: (
        <>
          {moved.length > 0 && (
            <p>
              Đã chuyển {moved.length} mục ({formatBytes(moved.reduce((s, r) => s + (offered.get(r.path)?.size ?? 0), 0))}) vào Thùng rác
            </p>
          )}
          {failed.length > 0 && (
            <>
              <p>{failed.length} mục không chuyển được</p>
              <ul>
                {failed.map((r) => (
                  <li key={r.path} className="truncate font-mono text-xs" title={r.path}>
                    {shortName(r.path)}: {r.error}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      ),
    })
  }

  const run = async () => {
    setBusy(true)
    setRejected(null)
    try {
      showResult(await api.cleanupTrash(chosen.map((e) => e.path)))
      setTicked(new Set())
      setConfirming(false)
      await qc.invalidateQueries({ queryKey: ['cleanup'] })
    } catch (e) {
      // The command itself failed: say so inside the dialog, keep it open to try again.
      setRejected(chosen.length)
      throw e
    } finally {
      setBusy(false)
    }
  }

  const g = data?.groups
  const nothing = !!g && g.redundant.length === 0 && g.aged.length === 0
  const offeredCount = (g?.redundant.length ?? 0) + (g?.aged.length ?? 0)

  const table = (key: GroupKey, list: CleanupEntry[]) => {
    const title = TITLE[key]
    const protectedGroup = key === 'never_touch'
    const picked = list.filter((e) => ticked.has(e.path)).length
    return (
      <Disclosure
        key={key}
        level={2}
        title={title}
        defaultOpen={!protectedGroup}
        aside={`${list.length} mục · ${formatBytes(sumSize(list))}`}
      >
        {key === 'aged' && (
          <div className="flex items-center gap-2 px-3 py-2 text-xs">
            <span>Cũ hơn:</span>
            <Segmented aria-label="Cũ hơn" value={cutoff} onChange={changeCutoff} options={CUTOFFS} />
          </div>
        )}
        {list.length === 0 ? (
          <p className="px-3 py-2 text-sm text-ink-muted">Không có mục nào</p>
        ) : (
          <div className="max-h-[360px] overflow-y-auto">
            <table aria-label={title} className="w-full table-fixed text-sm">
              <colgroup>
                <col className="w-10" />
                <col />
                <col className="w-24" />
                <col className="w-28" />
                {protectedGroup && <col className="w-40" />}
              </colgroup>
              <thead className="sticky top-0 z-10 bg-surface-1">
                <tr className="h-8 border-y border-line text-left text-xs font-medium text-ink-muted">
                  <th scope="col" className="px-3 font-medium">
                    {!protectedGroup && (
                      <Checkbox
                        aria-label={`Chọn tất cả trong ${title}`}
                        checked={picked === list.length}
                        indeterminate={picked > 0 && picked < list.length}
                        onChange={() => toggleAll(list)}
                      />
                    )}
                  </th>
                  <th scope="col" className="font-medium">Tên</th>
                  <th scope="col" className="text-right font-medium">Kích thước</th>
                  <th scope="col" className="pl-4 font-medium">Sửa lần cuối</th>
                  {protectedGroup && <th scope="col" className="font-medium">Lý do</th>}
                </tr>
              </thead>
              <tbody>
                {list.map((e) => (
                  <tr key={e.path} className="h-row-cleanup border-b border-line hover:bg-surface-2">
                    <td className="px-3">
                      {protectedGroup ? (
                        <>
                          <Lock aria-hidden size={14} className="text-ink-subtle" />
                          <span className="sr-only">Không chọn được</span>
                        </>
                      ) : (
                        <Checkbox aria-label={shortName(e.path)} checked={ticked.has(e.path)} onChange={() => toggle(e.path)} />
                      )}
                    </td>
                    <td className="truncate font-mono" title={e.path}>{shortName(e.path)}</td>
                    <td className="text-right tabular-nums">{formatBytes(e.size)}</td>
                    <td className="pl-4 tabular-nums">{day(e.mtime)}</td>
                    {protectedGroup && <td className="truncate">{REASON[e.reason ?? 'unclassified']}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Disclosure>
    )
  }

  let status = ''
  if (isLoading) status = 'Đang quét ~/.claude…'
  else if (nothing) status = 'Không có gì cần dọn'
  else if (g) status = `Có thể dọn ${offeredCount} mục · ${formatBytes(sumSize([...g.redundant, ...g.aged]))}`

  return (
    <div className="flex h-full min-h-0 w-full max-w-[960px] flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-4 p-4">
          <p className="h-6 text-xs text-ink-muted">{isError ? '' : status}</p>
          {isLoading && <Skeleton.Rows count={6} height={36} />}
          {isError && (
            <ErrorState title="Lỗi quét ~/.claude." detail={errorText(error)} onRetry={() => void refetch()} retrying={isRefetching} />
          )}
          {g && (
            <>
              {table('redundant', g.redundant)}
              {table('aged', g.aged)}
              {table('never_touch', g.never_touch)}
            </>
          )}
        </div>
      </div>
      {/* sticky as well as flex: the footer stays in view even if a parent scrolls instead of this column */}
      <div className="sticky bottom-0 flex h-footer-bar shrink-0 items-center justify-between border-t border-line bg-surface-1 px-4">
        <span className="text-sm tabular-nums">
          Đã chọn {chosen.length} mục · {formatBytes(total)}
        </span>
        <Button variant="primary" disabled={chosen.length === 0} onClick={() => setConfirming(true)}>
          Chuyển vào Thùng rác
        </Button>
      </div>
      {confirming && chosen.length > 0 && (
        <ConfirmDialog
          tone="danger"
          title={`Chuyển ${chosen.length} mục vào Thùng rác?`}
          description={`Tổng ${formatBytes(total)}. Khôi phục được từ Thùng rác.`}
          confirmLabel="Chuyển vào Thùng rác"
          busy={busy}
          error={rejected !== null ? `${rejected} mục không chuyển được` : undefined}
          onConfirm={run}
          onCancel={() => setConfirming(false)}
          details={
            <ul className="max-h-64 divide-y divide-line overflow-y-auto text-xs">
              {chosen.map((e) => (
                <li key={e.path} className="flex justify-between gap-3 py-1.5">
                  <span className="truncate font-mono" title={e.path}>{shortName(e.path)}</span>
                  <span className="shrink-0 tabular-nums">{formatBytes(e.size)}</span>
                </li>
              ))}
            </ul>
          }
        />
      )}
    </div>
  )
}
