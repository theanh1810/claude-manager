import clsx from 'clsx'
import { AlertCircle, RotateCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { TONE_FRAME } from './Badge'
import Button from './Button'

interface Props {
  title: string
  /** The raw error text, selectable and cut at four lines (the full text stays in the title attribute). */
  detail?: string
  onRetry?: () => void
  retryLabel?: string
  retrying?: boolean
  variant?: 'block' | 'inline'
  extra?: ReactNode
}

/** An alert with a real retry: each screen passes the refetch of the query that failed. */
export default function ErrorState({ title, detail, onRetry, retryLabel = 'Thử lại', retrying = false, variant = 'block', extra }: Props) {
  if (variant === 'inline') {
    return (
      <div role="alert" className={clsx('flex items-start gap-2 rounded-lg border p-3 text-sm', TONE_FRAME.danger)}>
        <AlertCircle aria-hidden size={16} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p>{title}</p>
          {detail && (
            <p title={detail} className="line-clamp-4 select-text font-mono text-xs [overflow-wrap:anywhere]">
              {detail}
            </p>
          )}
          {extra}
        </div>
        {onRetry && (
          <Button size="sm" icon={RotateCw} loading={retrying} onClick={onRetry}>
            {retryLabel}
          </Button>
        )}
      </div>
    )
  }
  return (
    <div role="alert" className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <AlertCircle aria-hidden size={32} className="text-danger-fg" />
      <p className="text-md font-semibold text-ink">{title}</p>
      {detail && (
        <p title={detail} className="line-clamp-4 max-w-full select-text font-mono text-xs text-ink-muted [overflow-wrap:anywhere]">
          {detail}
        </p>
      )}
      {extra}
      {onRetry && (
        <Button icon={RotateCw} loading={retrying} onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  )
}
