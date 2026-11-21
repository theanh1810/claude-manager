import clsx from 'clsx'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'accent'

/** Tone frame (border, fill, text) shared by Banner, ErrorState and the count chip. */
// eslint-disable-next-line react-refresh/only-export-components -- a table of classes, not a component
export const TONE_FRAME: Record<BadgeTone, string> = {
  success: 'border-success-line bg-success-bg text-success-fg',
  warning: 'border-warning-line bg-warning-bg text-warning-fg',
  danger: 'border-danger-line bg-danger-bg text-danger-fg',
  info: 'border-info-line bg-info-bg text-info-fg',
  neutral: 'border-line bg-surface-2 text-ink-muted',
  accent: 'border-transparent bg-accent-subtle text-accent-fg'
}

const ICON_ONLY: Record<BadgeTone, string> = {
  success: 'text-success-fg',
  warning: 'text-warning-fg',
  danger: 'text-danger-fg',
  info: 'text-info-fg',
  neutral: 'text-ink-muted',
  accent: 'text-accent-fg'
}

type BadgeProps = { tone: BadgeTone; icon?: LucideIcon } & (
  | { compact?: false; children: ReactNode }
  /** Icon only: the label becomes the accessible name and the title. */
  | { compact: true; icon: LucideIcon; label: string; children?: never }
)

/** Static status chip: never focusable, tone always paired with an icon or text. */
export default function Badge(props: BadgeProps) {
  const { tone, icon: Icon } = props
  if (props.compact) {
    const I = props.icon
    return (
      <span role="img" aria-label={props.label} title={props.label} className={clsx('inline-flex', ICON_ONLY[tone])}>
        <I aria-hidden size={16} />
      </span>
    )
  }
  return (
    <span className={clsx('inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-sm border px-1.5 text-xs font-medium', TONE_FRAME[tone])}>
      {Icon && <Icon aria-hidden size={12} />}
      {props.children}
    </span>
  )
}

const CAP = { normal: 999, rail: 99 }

/** Sidebar count. The meaning lives in the sr-only text of the nav item, so this is hidden from assistive tech. */
export function NavCount({ value, tone, rail = false }: { value: number; tone: 'warning' | 'plain'; rail?: boolean }) {
  const cap = rail ? CAP.rail : CAP.normal
  return (
    <span
      aria-hidden="true"
      className={clsx(
        'inline-flex items-center justify-center rounded-full text-xs tabular-nums',
        rail ? 'absolute -right-0.5 -top-0.5 h-4 min-w-4 px-1' : 'h-5 min-w-5 px-1.5',
        tone === 'warning' ? clsx('border', TONE_FRAME.warning) : 'text-ink-subtle'
      )}
    >
      {value > cap ? `${cap}+` : value}
    </span>
  )
}
