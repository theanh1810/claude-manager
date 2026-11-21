import clsx from 'clsx'
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { NoticeTone } from '@/stores/useNoticeStore'
import { TONE_FRAME } from './Badge'
import IconButton from './IconButton'

const ICON: Record<NoticeTone, LucideIcon> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: AlertCircle,
  neutral: Info
}

interface Props {
  tone: NoticeTone
  icon?: LucideIcon
  /** The leading icon turns: a loading state (Loader2). */
  spinIcon?: boolean
  title?: string
  children: ReactNode
  actions?: ReactNode
  onDismiss?: () => void
  /** `bleed` fills a status slot edge to edge, `overlay` is the floating form NoticeHost uses. */
  layout?: 'inline' | 'bleed' | 'overlay'
  /** Static document text (e.g. "Cần duyệt lại") uses `region` so it is not read aloud when it mounts. */
  role?: 'alert' | 'status' | 'region'
  'aria-labelledby'?: string
}

/** A banner never takes focus; danger announces itself, the other tones wait politely. */
export default function Banner({ tone, icon, spinIcon = false, title, children, actions, onDismiss, layout = 'inline', role, 'aria-labelledby': labelledBy }: Props) {
  const Icon = icon ?? ICON[tone]
  return (
    <div
      role={role ?? (tone === 'danger' ? 'alert' : 'status')}
      aria-labelledby={labelledBy}
      className={clsx(
        'flex items-start gap-2 px-3 py-2 text-xs',
        TONE_FRAME[tone],
        layout === 'bleed' ? 'border-b' : 'rounded-lg border',
        layout === 'overlay' && 'animate-fade-in shadow-popover'
      )}
    >
      <Icon aria-hidden size={16} className={clsx('mt-px shrink-0', spinIcon && 'animate-spin')} />
      <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        {title && <p className="font-medium">{title}</p>}
        <div>{children}</div>
        {actions && <div className="mt-1 flex gap-2">{actions}</div>}
      </div>
      {onDismiss && <IconButton size="sm" icon={X} label="Ẩn thông báo" onClick={onDismiss} />}
    </div>
  )
}
