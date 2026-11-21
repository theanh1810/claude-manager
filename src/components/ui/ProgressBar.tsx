import clsx from 'clsx'

interface Props {
  value: number
  max: number
  /** Becomes aria-label: a bar with no name says nothing to assistive tech. */
  label: string
  size?: 'sm' | 'md'
  tone?: 'success' | 'accent'
  /** Only the Sessions index bar animates. */
  animated?: boolean
  showValue?: boolean
}

/** The fill is a full-width bar scaled on X, so a change repaints no layout. */
export default function ProgressBar({ value, max, label, size = 'md', tone = 'success', animated = false, showValue = false }: Props) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0
  return (
    <div className="flex items-center gap-2">
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        className={clsx('flex-1 overflow-hidden rounded-full bg-surface-3', size === 'sm' ? 'h-1.5' : 'h-2')}
      >
        <div
          className={clsx(
            'h-full w-full origin-left rounded-full',
            tone === 'success' ? 'bg-progress' : 'bg-accent-fg',
            animated && 'transition-transform duration-base ease-standard'
          )}
          style={{ transform: `scaleX(${ratio})` }}
        />
      </div>
      {showValue && (
        <span className="text-xs tabular-nums text-ink-muted">
          {value}/{max}
        </span>
      )}
    </div>
  )
}
