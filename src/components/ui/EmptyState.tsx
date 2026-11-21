import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

interface Props {
  icon: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  /** `block` fills its container; `inline` is one line inside a list or group. */
  variant?: 'block' | 'inline'
}

/** Static content, so it carries no role: it sits inside a region that already has a name. */
export default function EmptyState({ icon: Icon, title, description, action, variant = 'block' }: Props) {
  if (variant === 'inline') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-sm text-ink-muted">
        <Icon aria-hidden size={16} />
        {title}
      </div>
    )
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <Icon aria-hidden size={32} className="text-ink-subtle" />
      <p className="text-md font-semibold text-ink">{title}</p>
      {description && <p className="max-w-[280px] text-sm text-ink-muted">{description}</p>}
      {action}
    </div>
  )
}
