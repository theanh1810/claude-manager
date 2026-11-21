import clsx from 'clsx'
import FocusTrap from 'focus-trap-react'
import { X } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { modalFocusTrapOptions } from '@/lib/modalFocusTrap'
import IconButton from './IconButton'

type Size = 'sm' | 'md' | 'lg'

const SIZE: Record<Size, string> = { sm: 'w-dialog-sm', md: 'w-dialog-md', lg: 'w-dialog-lg' }

/** Open dialogs, innermost last: only the top one answers Esc, so a confirm over Settings closes alone. */
const openStack: symbol[] = []

interface Props {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  size?: Size
  /** CSS selector of the element that takes focus first; default is the first tabbable. */
  initialFocus?: string
  /** A pending action: Esc, the scrim and the close button do nothing. */
  busy?: boolean
  children: ReactNode
  footer?: ReactNode
}

/** Modal with a focus trap. Every dialog is aria-modal so the global key handler stands down while one is open. */
export default function Dialog({ open, onClose, title, description, size = 'md', initialFocus, busy = false, children, footer }: Props) {
  const titleId = useId()
  const descId = useId()
  const token = useRef(Symbol('dialog'))

  useEffect(() => {
    if (!open) return
    const mine = token.current
    openStack.push(mine)
    return () => {
      openStack.splice(openStack.indexOf(mine), 1)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || openStack[openStack.length - 1] !== token.current) return
      e.stopPropagation()
      if (!busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  if (!open) return null
  return (
    <FocusTrap focusTrapOptions={{ ...modalFocusTrapOptions, ...(initialFocus ? { initialFocus } : {}) }}>
      <div
        data-scrim
        className="fixed inset-0 z-modal flex animate-fade-in items-center justify-center bg-scrim"
        onClick={(e) => {
          if (e.target === e.currentTarget && !busy) onClose()
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descId : undefined}
          className={clsx(
            'flex max-h-[85vh] max-w-[92vw] animate-enter-scale flex-col rounded-xl border border-line bg-surface-0 shadow-dialog',
            SIZE[size]
          )}
        >
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-5">
            <h2 id={titleId} className="text-md font-semibold text-ink">
              {title}
            </h2>
            {/* Stays focusable while busy: a trap with every control disabled throws, and it is the way out once the action ends. */}
            <IconButton label="Đóng" icon={X} size="sm" aria-disabled={busy || undefined} onClick={() => !busy && onClose()} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {description && (
              <p id={descId} className="mb-3 text-sm text-ink-muted">
                {description}
              </p>
            )}
            {children}
          </div>
          {footer && <div className="flex shrink-0 justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </div>
      </div>
    </FocusTrap>
  )
}
