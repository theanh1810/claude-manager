import { AlertCircle, AlertTriangle, Brain, Check, CheckCheck, Clock, Hourglass, Lock, Undo2, X, XCircle, type LucideIcon } from 'lucide-react'
import type { EditStatus } from '@/types/edit'
import type { MemoryKind } from '@/types/memory'
import type { PlanApproval, PlanVerdict } from '@/types/spec'
import Badge, { type BadgeTone } from './Badge'

interface Mark {
  tone: BadgeTone
  icon: LucideIcon
  label: string
}

/** The one place that maps a state of the app to its tone, icon and Vietnamese label (tokens.md section 2.4). */
// eslint-disable-next-line react-refresh/only-export-components -- the table is the contract; tests and non-badge consumers read it
export const STATUS_MARKS: {
  edit: Record<EditStatus, Mark>
  memory: Record<MemoryKind, Mark>
  approval: Record<PlanApproval, Mark>
  verdict: Record<PlanVerdict, Mark>
  mark: Record<'closed' | 'readonly', Mark>
} = {
  edit: {
    pending: { tone: 'warning', icon: Clock, label: 'Chờ' },
    pending_decision: { tone: 'info', icon: Hourglass, label: 'Chờ quyết định' },
    accepted: { tone: 'success', icon: Check, label: 'Đã chấp nhận' },
    rejected: { tone: 'danger', icon: X, label: 'Đã từ chối' },
    rolled_back: { tone: 'neutral', icon: Undo2, label: 'Đã hoàn tác' },
    auto_accepted: { tone: 'info', icon: CheckCheck, label: 'Tự chấp nhận' }
  },
  memory: {
    memory: { tone: 'info', icon: Brain, label: 'Memory' },
    error: { tone: 'danger', icon: AlertCircle, label: 'Lỗi' }
  },
  approval: {
    approved: { tone: 'success', icon: Check, label: 'Plan đã duyệt' },
    not_approved: { tone: 'warning', icon: Clock, label: 'Plan chưa duyệt' },
    stale: { tone: 'danger', icon: AlertTriangle, label: 'Cần duyệt lại' }
  },
  verdict: {
    red: { tone: 'danger', icon: XCircle, label: 'Đỏ' },
    yellow: { tone: 'warning', icon: AlertTriangle, label: 'Vàng' },
    green: { tone: 'success', icon: Check, label: 'Xanh' }
  },
  mark: {
    closed: { tone: 'neutral', icon: Lock, label: 'Đã đóng' },
    readonly: { tone: 'neutral', icon: Lock, label: 'Chỉ đọc' }
  }
}

type Tables = typeof STATUS_MARKS
type Props = { [K in keyof Tables]: { kind: K; value: keyof Tables[K]; compact?: boolean } }[keyof Tables]

export default function StatusMark({ kind, value, compact = false }: Props) {
  const m = (STATUS_MARKS[kind] as Record<string, Mark | undefined>)[value as string]
  if (!m) return null // a value outside the contract reads as no mark
  if (compact) return <Badge tone={m.tone} icon={m.icon} compact label={m.label} />
  return (
    <Badge tone={m.tone} icon={m.icon}>
      {m.label}
    </Badge>
  )
}
