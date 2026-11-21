import clsx from 'clsx'
import { Loader2, type LucideIcon } from 'lucide-react'
import type { ButtonHTMLAttributes } from 'react'

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'success'
  | 'danger'
  | 'danger-subtle'
  | 'warning'
  | 'accent-subtle'
export type ButtonSize = 'sm' | 'md' | 'lg'

// eslint-disable-next-line react-refresh/only-export-components -- IconButton shares the disabled look
export const DISABLED_CLASS = 'disabled:cursor-not-allowed disabled:border-line disabled:bg-surface-2 disabled:text-ink-disabled'

const BASE = clsx('inline-flex items-center justify-center gap-1.5 rounded-md border whitespace-nowrap select-none', DISABLED_CLASS)

// eslint-disable-next-line react-refresh/only-export-components -- IconButton reuses these rows so the variants stay one table
export const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'border-transparent bg-accent text-accent-on hover:bg-accent-hover active:bg-accent-active',
  secondary: 'border-line-strong bg-surface-2 text-ink hover:bg-surface-3 active:bg-surface-3',
  ghost: 'border-transparent bg-transparent text-ink-muted hover:bg-surface-2 active:bg-surface-3',
  success: 'border-transparent bg-success-solid text-accent-on hover:bg-success-solid-hover active:bg-success-solid-hover',
  danger: 'border-transparent bg-danger-solid text-accent-on hover:bg-danger-solid-hover active:bg-danger-solid-hover',
  'danger-subtle': 'border-danger-line bg-danger-bg text-danger-fg hover:bg-danger-line active:bg-danger-line',
  warning: 'border-transparent bg-warning-solid text-accent-on hover:bg-warning-solid-hover active:bg-warning-solid-hover',
  'accent-subtle': 'border-transparent bg-accent-subtle text-accent-fg hover:bg-accent-subtle-hover active:bg-accent-subtle-hover'
}

// eslint-disable-next-line react-refresh/only-export-components -- IconButton shares the toggle look
export const TOGGLE_CLASS = {
  off: VARIANT_CLASS.secondary,
  on: 'border-accent-fg bg-accent-subtle text-ink hover:bg-accent-subtle active:bg-accent-subtle'
}

const SIZE: Record<ButtonSize, { box: string; icon: number }> = {
  sm: { box: 'h-7 px-2 text-xs font-medium', icon: 14 },
  md: { box: 'h-8 px-3 text-sm font-medium', icon: 16 },
  lg: { box: 'h-9 px-4 text-sm font-medium', icon: 16 }
}

const SOLID: ButtonVariant[] = ['primary', 'success', 'danger', 'warning']

export function Spinner({ size = 14 }: { size?: number }) {
  return <Loader2 aria-hidden size={size} className="animate-spin" />
}

/** Key chip: outline only, a filled chip would lower the contrast of the label. */
export function Kbd({ children, onSolid = false }: { children: string; onSolid?: boolean }) {
  return (
    <kbd
      className={clsx(
        'inline-flex h-4 min-w-4 items-center justify-center rounded-sm border px-1 font-mono text-xs',
        onSolid ? 'border-accent-on/60' : 'border-line-strong text-ink-muted'
      )}
    >
      {children}
    </kbd>
  )
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: LucideIcon
  loading?: boolean
  /** A boolean turns the button into a toggle that exposes aria-pressed. */
  pressed?: boolean
  kbd?: string
  fullWidth?: boolean
}

export default function Button({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  loading = false,
  pressed,
  kbd,
  fullWidth = false,
  className,
  disabled,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  const toggle = pressed !== undefined
  const s = SIZE[size]
  const look = toggle ? (pressed ? TOGGLE_CLASS.on : TOGGLE_CLASS.off) : VARIANT_CLASS[variant]
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-pressed={toggle ? pressed : undefined}
      className={clsx(BASE, s.box, look, fullWidth && 'w-full', className)}
      {...rest}
    >
      {loading ? <Spinner size={s.icon} /> : Icon && <Icon aria-hidden size={s.icon} className={clsx(pressed && 'text-accent-fg')} />}
      {children}
      {kbd && <Kbd onSolid={!toggle && SOLID.includes(variant)}>{kbd}</Kbd>}
    </button>
  )
}
