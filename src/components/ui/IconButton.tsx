import clsx from 'clsx'
import type { LucideIcon } from 'lucide-react'
import type { ButtonHTMLAttributes } from 'react'
import { DISABLED_CLASS, Spinner, TOGGLE_CLASS, VARIANT_CLASS } from './Button'
import Tooltip from './Tooltip'

type Size = 'sm' | 'md' | 'rail'
type Variant = 'ghost' | 'secondary' | 'accent-subtle' | 'danger-ghost'

const SIZE: Record<Size, { box: string; icon: number }> = {
  sm: { box: 'size-7', icon: 16 },
  md: { box: 'size-8', icon: 16 },
  rail: { box: 'size-10', icon: 20 }
}

const VARIANT: Record<Variant, string> = {
  ghost: VARIANT_CLASS.ghost,
  secondary: VARIANT_CLASS.secondary,
  'accent-subtle': VARIANT_CLASS['accent-subtle'],
  'danger-ghost': 'border-transparent bg-transparent text-danger-fg hover:bg-danger-bg active:bg-danger-line'
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> {
  /** The accessible name and the tooltip text. Required: an icon alone names nothing. */
  label: string
  icon: LucideIcon
  size?: Size
  variant?: Variant
  /** A boolean turns the button into a toggle that exposes aria-pressed. */
  pressed?: boolean
  /** Shown in the tooltip, e.g. "⌘B". */
  shortcut?: string
  loading?: boolean
}

export default function IconButton({
  label,
  icon: Icon,
  size = 'md',
  variant = 'ghost',
  pressed,
  shortcut,
  loading = false,
  className,
  disabled,
  type = 'button',
  ...rest
}: IconButtonProps) {
  const s = SIZE[size]
  const toggle = pressed !== undefined
  const look = toggle ? (pressed ? TOGGLE_CLASS.on : TOGGLE_CLASS.off) : VARIANT[variant]
  return (
    <Tooltip
      content={
        shortcut ? (
          <>
            {label} <span className="font-mono">{shortcut}</span>
          </>
        ) : (
          label
        )
      }
      side={size === 'rail' ? 'right' : 'top'}
    >
      <button
        type={type}
        aria-label={label}
        aria-pressed={toggle ? pressed : undefined}
        aria-busy={loading || undefined}
        disabled={disabled || loading}
        className={clsx(
          'inline-flex shrink-0 items-center justify-center rounded-md border select-none',
          DISABLED_CLASS,
          s.box,
          look,
          className
        )}
        {...rest}
      >
        {loading ? <Spinner size={s.icon} /> : <Icon aria-hidden size={s.icon} strokeWidth={1.75} className={clsx(pressed && 'text-accent-fg')} />}
      </button>
    </Tooltip>
  )
}
