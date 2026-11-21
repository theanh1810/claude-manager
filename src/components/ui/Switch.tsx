import clsx from 'clsx'
import type { LucideIcon } from 'lucide-react'
import { useId } from 'react'
import IconButton from './IconButton'

type Props = {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label: string
  description?: string
  loading?: boolean
  disabled?: boolean
} & ({ layout?: 'row' } | { layout: 'icon'; icon: LucideIcon })

/** role="switch" button. The row layout is one hit area; the icon layout is the rail form built on IconButton. */
export default function Switch(props: Props) {
  const { checked, onCheckedChange, label, description, loading = false, disabled = false } = props
  const labelId = useId()
  const descId = useId()
  const off = disabled || loading

  if (props.layout === 'icon') {
    return (
      <IconButton
        role="switch"
        aria-checked={checked}
        label={label}
        icon={props.icon}
        size="rail"
        variant={checked ? 'accent-subtle' : 'ghost'}
        loading={loading}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
      />
    )
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-busy={loading || undefined}
      aria-labelledby={labelId}
      aria-describedby={description ? descId : undefined}
      disabled={off}
      onClick={() => onCheckedChange(!checked)}
      className="group flex min-h-8 w-full items-center gap-2 rounded-md text-left disabled:cursor-not-allowed"
    >
      <span className="min-w-0 flex-1">
        <span id={labelId} className={clsx('block text-sm', off ? 'text-ink-disabled' : 'text-ink')}>
          {label}
        </span>
        {description && (
          <span id={descId} className="block text-xs text-ink-muted">
            {description}
          </span>
        )}
      </span>
      <span
        data-track
        className={clsx(
          'relative inline-block h-5 w-8 shrink-0 rounded-full',
          off ? 'bg-surface-3' : checked ? 'bg-accent-fg group-hover:bg-accent-hover' : 'bg-line-control group-hover:bg-ink-subtle'
        )}
      >
        <span
          data-knob
          className={clsx(
            'absolute left-0.5 top-0.5 size-4 rounded-full bg-knob transition-transform duration-fast ease-standard',
            checked && 'translate-x-3'
          )}
        />
      </span>
    </button>
  )
}
