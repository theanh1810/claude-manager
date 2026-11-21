import clsx from 'clsx'
import type { LucideIcon } from 'lucide-react'
import { useRef, type KeyboardEvent } from 'react'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  icon?: LucideIcon
}

interface Props<T extends string> {
  value: T
  onChange: (value: T) => void
  options: SegmentedOption<T>[]
  'aria-label': string
  disabled?: boolean
}

/** Radiogroup: the checked option is the one tab stop, arrows move and select, Home and End jump. */
export default function Segmented<T extends string>({ value, onChange, options, 'aria-label': ariaLabel, disabled = false }: Props<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const checked = options.findIndex((o) => o.value === value)
  const stop = checked >= 0 ? checked : 0

  const go = (to: number) => {
    onChange(options[to].value)
    refs.current[to]?.focus()
  }
  const onKeyDown = (e: KeyboardEvent, i: number) => {
    const last = options.length - 1
    const next: Record<string, number> = {
      ArrowRight: i === last ? 0 : i + 1,
      ArrowDown: i === last ? 0 : i + 1,
      ArrowLeft: i === 0 ? last : i - 1,
      ArrowUp: i === 0 ? last : i - 1,
      Home: 0,
      End: last
    }
    if (e.key in next) {
      e.preventDefault()
      go(next[e.key])
    }
  }

  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex h-8 gap-0.5 rounded-md border border-line bg-surface-2 p-0.5">
      {options.map((o, i) => {
        const on = i === checked
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={i === stop ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={clsx(
              'focus-inset inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-sm border px-3 text-xs font-medium disabled:cursor-not-allowed disabled:text-ink-disabled',
              on ? 'border-line-strong bg-surface-0 text-ink' : 'border-transparent text-ink-muted hover:bg-surface-3 hover:text-ink'
            )}
          >
            {o.icon && <o.icon aria-hidden size={14} />}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
