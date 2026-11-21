import clsx from 'clsx'
import { Check, Minus } from 'lucide-react'
import { useEffect, useRef, type InputHTMLAttributes } from 'react'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  indeterminate?: boolean
} & ({ label: string } | { label?: undefined; 'aria-label': string })

/** A real `<input type="checkbox">`, restyled; the wrapping label gives it a hit area of at least 28px. */
export default function Checkbox({ label, indeterminate = false, className, ...rest }: Props) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])

  return (
    <label className={clsx('inline-flex min-h-7 cursor-pointer items-center gap-2 text-sm text-ink', className)}>
      <span className="relative inline-flex size-4 shrink-0 items-center justify-center">
        <input
          ref={ref}
          type="checkbox"
          {...rest}
          className={clsx(
            'peer size-4 cursor-pointer appearance-none rounded-sm border disabled:cursor-not-allowed disabled:border-line disabled:bg-surface-2',
            indeterminate
              ? 'border-accent-fg bg-accent-fg'
              : 'border-line-control bg-surface-0 checked:border-accent-fg checked:bg-accent-fg [&:not(:checked):hover]:border-ink-subtle',
            rest['aria-invalid'] && 'border-danger-solid'
          )}
        />
        {indeterminate ? (
          <Minus aria-hidden size={12} className="pointer-events-none absolute text-knob" />
        ) : (
          <Check aria-hidden size={12} className="pointer-events-none absolute hidden text-knob peer-checked:block" />
        )}
      </span>
      {label}
    </label>
  )
}
