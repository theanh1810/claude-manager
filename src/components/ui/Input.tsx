import clsx from 'clsx'
import type { LucideIcon } from 'lucide-react'
import { useId, type InputHTMLAttributes, type KeyboardEvent } from 'react'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  leadingIcon?: LucideIcon
  hint?: string
  error?: string
  size?: 'sm' | 'md'
} & ({ label: string } | { label?: undefined; 'aria-label': string })

/** Sets the value through the native setter so React sees an ordinary input event. */
function clearInput(el: HTMLInputElement) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, '')
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

export default function Input({ label, leadingIcon: Icon, hint, error, size = 'md', className, onKeyDown, ...rest }: Props) {
  const id = useId()
  const messageId = `${id}-message`
  const message = error ?? hint
  const isSearch = rest.type === 'search'
  const isPassword = rest.type === 'password'

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(e)
    if (!isSearch || e.defaultPrevented) return
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (e.currentTarget.value) clearInput(e.currentTarget)
      else e.currentTarget.blur()
    } else if (e.key === 'ArrowDown') {
      const list = document.querySelector<HTMLElement>('[data-primary-list]')
      if (list) {
        e.preventDefault()
        list.focus()
      }
    }
  }

  return (
    <div className={clsx('flex flex-col gap-1', className)}>
      {label && (
        <label htmlFor={id} className="text-xs font-medium text-ink">
          {label}
        </label>
      )}
      <div className="relative">
        {Icon && <Icon aria-hidden size={16} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-subtle" />}
        <input
          {...rest}
          id={id}
          autoComplete={isPassword ? 'off' : rest.autoComplete}
          spellCheck={isPassword ? false : rest.spellCheck}
          aria-invalid={error ? true : undefined}
          aria-describedby={[rest['aria-describedby'], message ? messageId : undefined].filter(Boolean).join(' ') || undefined}
          onKeyDown={handleKeyDown}
          className={clsx(
            'w-full rounded-md border bg-surface-0 px-3 text-sm text-ink placeholder:text-ink-subtle',
            'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-disabled',
            size === 'sm' ? 'h-7' : 'h-8',
            Icon && 'pl-8',
            error ? 'border-danger-solid' : 'border-line-control hover:border-ink-subtle focus-visible:border-accent-fg'
          )}
        />
      </div>
      {(label || message) && (
        <p id={messageId} className={clsx('min-h-4 text-xs', error ? 'text-danger-fg' : 'text-ink-subtle')}>
          {message}
        </p>
      )}
    </div>
  )
}
