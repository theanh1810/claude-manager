import clsx from 'clsx'
import { cloneElement, useEffect, useId, useRef, useState, type FocusEvent, type ReactElement, type ReactNode } from 'react'

type Side = 'top' | 'right' | 'bottom'

const SIDE: Record<Side, string> = {
  top: 'bottom-full left-1/2 mb-1 -translate-x-1/2',
  bottom: 'left-1/2 top-full mt-1 -translate-x-1/2',
  right: 'left-full top-1/2 ml-1 -translate-y-1/2'
}

const HOVER_DELAY_MS = 400

function isFocusVisible(el: EventTarget): boolean {
  try {
    return (el as Element).matches(':focus-visible')
  } catch {
    return true // an engine without the selector: treat keyboard and pointer focus alike
  }
}

interface Props {
  content: ReactNode
  /** One element that takes `aria-describedby`. */
  children: ReactElement<{ 'aria-describedby'?: string }>
  side?: Side
}

/** Name for icon-only controls: opens 400ms after hover, at once on keyboard focus, closes on leave, blur or Esc. */
export default function Tooltip({ content, children, side = 'top' }: Props) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  const clear = () => {
    window.clearTimeout(timer.current)
    timer.current = undefined
  }
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const hide = () => {
    clear()
    setOpen(false)
  }
  const onFocus = (e: FocusEvent) => {
    if (isFocusVisible(e.target)) {
      clear()
      setOpen(true)
    }
  }

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => {
        clear()
        timer.current = window.setTimeout(() => setOpen(true), HOVER_DELAY_MS)
      }}
      onMouseLeave={hide}
      onFocus={onFocus}
      onBlur={hide}
      onKeyDown={(e) => e.key === 'Escape' && hide()}
    >
      {cloneElement(children, { 'aria-describedby': open ? id : children.props['aria-describedby'] })}
      {open && (
        <span
          role="tooltip"
          id={id}
          className={clsx(
            'pointer-events-none absolute z-popover w-max max-w-tooltip animate-fade-in rounded-md bg-tooltip-bg px-2 py-1 text-xs text-tooltip-fg shadow-popover',
            SIDE[side]
          )}
        >
          {content}
        </span>
      )}
    </span>
  )
}
