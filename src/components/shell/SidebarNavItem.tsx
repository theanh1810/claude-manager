import clsx from 'clsx'
import { NavCount } from '@/components/ui/Badge'
import Tooltip from '@/components/ui/Tooltip'
import type { Screen, ScreenKey } from '@/lib/navigation'

/** The count of one item. Left out for the screens that have none. */
export interface NavItemCount {
  status: 'loading' | 'ready' | 'error'
  value: number | null
  tone: 'warning' | 'plain'
}

interface Props {
  screen: Screen
  active: boolean
  rail: boolean
  count?: NavItemCount
  onSelect: (key: ScreenKey) => void
}

const ERROR_TITLE = 'Không tải được số lượng'

/** One sidebar item. The count is hidden from assistive tech; its meaning is in the accessible name. */
export default function SidebarNavItem({ screen, active, rail, count, onSelect }: Props) {
  const Icon = screen.icon
  const known = count?.status === 'ready' && count.value !== null
  const button = (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      // The visible label leads the name, the count follows it: one string, so no reader pauses between them.
      aria-label={known ? `${screen.title}, ${count.value} thay đổi` : undefined}
      onClick={() => onSelect(screen.key)}
      className={clsx(
        'focus-inset relative flex items-center rounded-md text-sm',
        rail ? 'size-10 justify-center' : 'h-8 w-full gap-2 px-2',
        active
          ? 'bg-accent-subtle text-ink before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-full before:bg-accent-fg'
          : 'text-ink-muted hover:bg-surface-2 hover:text-ink'
      )}
    >
      <Icon aria-hidden size={rail ? 20 : 16} strokeWidth={1.75} className={clsx('shrink-0', active && 'text-accent-fg')} />
      <span className={clsx(rail ? 'sr-only' : 'min-w-0 flex-1 truncate text-left')}>{screen.title}</span>
      {count && (
        <span className={clsx('flex shrink-0 justify-end', rail ? 'absolute right-0 top-0' : 'w-7')}>
          {known ? (
            <NavCount value={count.value as number} tone={count.tone} rail={rail} />
          ) : count.status === 'error' ? (
            <span aria-hidden="true" title={ERROR_TITLE} className="text-xs text-ink-subtle">
              —
            </span>
          ) : null}
        </span>
      )}
    </button>
  )
  return <li>{rail ? <Tooltip content={screen.title} side="right">{button}</Tooltip> : button}</li>
}
