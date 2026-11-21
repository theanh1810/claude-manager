import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/ipc'
import { CheckCheck, XCircle } from 'lucide-react'
import { LEGACY_CONFIRM_CODE } from '@/features/edits/useEditDecision'
import { errorText, shortPath } from '@/lib/format'
import { useNoticeStore } from '@/stores/useNoticeStore'
import { useReviewFilterStore } from '@/stores/useReviewFilterStore'
import type { Edit } from '@/types/edit'
import Button from './ui/Button'
import { useConfirm } from './ui/ConfirmProvider'

type BulkResult = { success: number; failed: number; errors: string[] }
type Kind = 'accept' | 'reject'

/** Both results share one id, so a new result replaces the earlier one. */
const RESULT_NOTICE_ID = 'bulk-result'
/** A clean result leaves after this long; one with failures stays until the user hides it. */
const CLEAN_RESULT_MS = 3000
const FILTER_REASON = 'Đang lọc — bỏ bộ lọc để duyệt hàng loạt'
const NOTHING_PENDING_REASON = 'Không có thay đổi nào đang chờ duyệt'
const LEGACY_BULK_LINE = 'Thay đổi cũ, cần xác nhận riêng — mở mục này để từ chối'

/** Rust reports each failure as "id: message"; the id is a uuid, so split at the first ': '. */
function splitError(entry: string): { id: string; message: string } {
  const i = entry.indexOf(': ')
  return i < 0 ? { id: entry, message: entry } : { id: entry.slice(0, i), message: entry.slice(i + 2) }
}

interface Props {
  pendingCount: number
  projectPath?: string | null
  projectName?: string | null
}

export default function BulkActionBar({ pendingCount, projectPath, projectName }: Props) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const notify = useNoticeStore((s) => s.notify)
  const dismiss = useNoticeStore((s) => s.dismiss)
  // A bulk action must never reach changes the user cannot see.
  const filtered = useReviewFilterStore((s) => s.claudeOnly.pending || s.sessionId !== null)

  const finish = (kind: Kind, r: BulkResult) => {
    // Read before the refetch below: a failed change is still pending in the list, a done one is read from the snapshot.
    const rows = qc.getQueryData<Edit[]>(['edits', 'all'])
    const pathOf = (id: string) => {
      const path = rows?.find((e) => e.id === id)?.path
      return path ? shortPath(path) : id
    }
    qc.invalidateQueries({ queryKey: ['edits'] })
    const head = `${kind === 'accept' ? 'Đã chấp nhận' : 'Đã từ chối'} ${r.success} mục`
    if (r.failed === 0 && r.errors.length === 0) {
      notify({ id: RESULT_NOTICE_ID, tone: 'success', autoHideMs: CLEAN_RESULT_MS, children: head })
      return
    }
    notify({
      id: RESULT_NOTICE_ID,
      tone: 'danger',
      children: (
        <>
          <p>{head}</p>
          <p>{`${r.failed} mục không xử lý được:`}</p>
          <ul>
            {r.errors.map(splitError).map((f) => (
              <li key={f.id}>{`${pathOf(f.id)}: ${f.message === LEGACY_CONFIRM_CODE ? LEGACY_BULK_LINE : f.message}`}</li>
            ))}
          </ul>
        </>
      )
    })
  }
  const fail = (e: unknown) => notify({ id: RESULT_NOTICE_ID, tone: 'danger', children: errorText(e) })

  const acceptAll = useMutation({
    mutationFn: () => api.acceptAll(projectPath ?? undefined),
    onSuccess: (r) => finish('accept', r),
    onError: fail
  })
  const rejectAll = useMutation({
    mutationFn: () => api.rejectAll(projectPath ?? undefined),
    onSuccess: (r) => finish('reject', r),
    onError: fail
  })

  const scope = projectName ? `project "${projectName}"` : 'TẤT CẢ project'
  const busy = acceptAll.isPending || rejectAll.isPending
  const reason = filtered ? FILTER_REASON : pendingCount === 0 ? NOTHING_PENDING_REASON : undefined
  const off = busy || reason !== undefined

  const onAcceptAll = async () => {
    const ok = await confirm({
      title: `Chấp nhận tất cả ${pendingCount} thay đổi đang chờ?`,
      description: `Áp dụng cho ${scope}. File giữ nguyên nội dung hiện tại.`,
      confirmLabel: 'Chấp nhận tất cả'
    })
    if (!ok) return
    dismiss(RESULT_NOTICE_ID)
    acceptAll.mutate()
  }
  const onRejectAll = async () => {
    const ok = await confirm({
      tone: 'danger',
      title: `Từ chối và hoàn tác tất cả ${pendingCount} thay đổi đang chờ?`,
      description: `Áp dụng cho ${scope}. File sẽ được khôi phục về trạng thái trước thay đổi.`,
      confirmLabel: 'Từ chối tất cả'
    })
    if (!ok) return
    dismiss(RESULT_NOTICE_ID)
    rejectAll.mutate()
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Button variant="secondary" icon={CheckCheck} loading={acceptAll.isPending} disabled={off} title={reason} onClick={onAcceptAll}>
        Chấp nhận tất cả
      </Button>
      <Button variant="danger-subtle" icon={XCircle} loading={rejectAll.isPending} disabled={off} title={reason} onClick={onRejectAll}>
        Từ chối tất cả
      </Button>
    </div>
  )
}
