import clsx from 'clsx'
import { Check, type LucideIcon } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEventHandler, type ReactNode, type Ref } from 'react'

export interface MenuItem {
  id: string
  label: string
  icon?: LucideIcon
  onSelect: () => void
  /** A boolean makes the item a radio (menuitemradio); leave it out for an action (menuitem). */
  checked?: boolean
  disabled?: boolean
  separatorBefore?: boolean
}

export interface MenuTriggerProps {
  id: string
  ref: Ref<HTMLButtonElement>
  'aria-haspopup': 'menu'
  'aria-expanded': boolean
  'aria-controls': string | undefined
  onClick: MouseEventHandler<HTMLButtonElement>
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void
}

interface Props {
  /** The accessible name of the menu itself. */
  label: string
  items: MenuItem[]
  /** Spread the given props onto your own button: `renderTrigger={(p) => <button {...p}>…</button>}`. */
  renderTrigger: (props: MenuTriggerProps) => ReactNode
  /** Under the button (sidebar open) or to its right (rail). */
  side?: 'bottom' | 'right'
  className?: string
}

/** Menu button pattern: focus stays on the menu, the active item is announced through aria-activedescendant. */
export default function Menu({ label, items, renderTrigger, side = 'bottom', className }: Props) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const triggerId = useId()
  const menuId = useId()

  const enabled = (i: number) => !items[i].disabled
  const firstEnabled = () => items.findIndex((_, i) => enabled(i))
  const lastEnabled = () => items.map((_, i) => i).reverse().find(enabled) ?? -1
  const step = (from: number, dir: 1 | -1) => {
    for (let n = 1; n <= items.length; n += 1) {
      const i = (from + dir * n + items.length * n) % items.length
      if (enabled(i)) return i
    }
    return from
  }

  const openMenu = () => {
    const checked = items.findIndex((it, i) => it.checked && enabled(i))
    setActive(checked >= 0 ? checked : Math.max(0, firstEnabled()))
    setOpen(true)
  }
  const close = (refocus: boolean) => {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }
  const choose = (i: number) => {
    if (!enabled(i)) return
    items[i].onSelect()
    close(true)
  }

  useEffect(() => {
    if (open) menuRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        setActive(step(active, 1))
        break
      case 'ArrowUp':
        setActive(step(active, -1))
        break
      case 'Home':
        setActive(firstEnabled())
        break
      case 'End':
        setActive(lastEnabled())
        break
      case 'Enter':
      case ' ':
        choose(active)
        break
      case 'Escape':
        e.stopPropagation()
        close(true)
        break
      case 'Tab':
        close(true)
        return // not prevented: focus moves on from the button
      default: {
        if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return
        const typed = e.key.toLowerCase()
        const from = items.findIndex((it, i) => i > active && enabled(i) && it.label.toLowerCase().startsWith(typed))
        const found = from >= 0 ? from : items.findIndex((it, i) => enabled(i) && it.label.toLowerCase().startsWith(typed))
        if (found >= 0) setActive(found)
        break
      }
    }
    e.preventDefault()
  }

  const trigger: MenuTriggerProps = {
    id: triggerId,
    ref: triggerRef,
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': open ? menuId : undefined,
    onClick: () => (open ? close(false) : openMenu()),
    onKeyDown: (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (!open) openMenu()
      }
    }
  }

  return (
    <div ref={wrapperRef} className={clsx('relative inline-block', className)}>
      {renderTrigger(trigger)}
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          tabIndex={-1}
          aria-label={label}
          aria-activedescendant={`${menuId}-${items[active]?.id}`}
          onKeyDown={onMenuKeyDown}
          className={clsx(
            'absolute z-dropdown max-h-menu w-menu min-w-full animate-fade-in overflow-y-auto rounded-lg border border-line bg-surface-0 p-1 shadow-popover',
            side === 'bottom' ? 'left-0 top-full mt-1' : 'left-full top-0 ml-1'
          )}
        >
          {items.map((item, i) => (
            <div key={item.id}>
              {item.separatorBefore && <div role="separator" className="my-1 border-t border-line" />}
              <div
                id={`${menuId}-${item.id}`}
                role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
                aria-checked={item.checked}
                aria-disabled={item.disabled || undefined}
                onMouseEnter={() => enabled(i) && setActive(i)}
                onClick={() => choose(i)}
                className={clsx(
                  'flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-sm',
                  item.disabled ? 'cursor-not-allowed text-ink-disabled' : 'text-ink',
                  i === active && !item.disabled && 'bg-surface-2'
                )}
              >
                {item.icon && <item.icon aria-hidden size={16} className="shrink-0 text-ink-muted" />}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.checked && <Check aria-hidden size={14} className="shrink-0 text-accent-fg" />}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
