import { useRef, type ReactNode } from 'react'
import Banner from './Banner'
import Button from './Button'
import Dialog from './Dialog'

export interface ConfirmDialogProps {
  title: string
  description: string
  /** Extra detail under the description, e.g. the list of files. */
  details?: ReactNode
  confirmLabel: string
  cancelLabel?: string
  tone?: 'neutral' | 'danger'
  busy?: boolean
  /** Shown when onConfirm failed; the dialog stays open so the user can try again. */
  error?: string
  /** May return a promise. A rejection leaves the dialog open and the button usable. */
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

/** Cancel, Esc and the scrim call only onCancel. A danger dialog starts on Hủy so a stray Enter cannot destroy anything. */
export default function ConfirmDialog({
  title,
  description,
  details,
  confirmLabel,
  cancelLabel = 'Hủy',
  tone = 'neutral',
  busy = false,
  error,
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  const inFlight = useRef(false)
  const danger = tone === 'danger'

  const confirm = async () => {
    if (inFlight.current) return
    inFlight.current = true
    try {
      await onConfirm()
    } catch {
      inFlight.current = false // the caller shows the reason; the user may confirm again
    }
  }

  return (
    <Dialog
      open
      size="sm"
      title={title}
      description={description}
      busy={busy}
      onClose={onCancel}
      initialFocus="[data-initial-focus]"
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onCancel} data-initial-focus={danger ? '' : undefined}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={confirm} data-initial-focus={danger ? undefined : ''}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {error && (
        <div className="mb-3">
          <Banner tone="danger" layout="inline">
            {error}
          </Banner>
        </div>
      )}
      {details}
    </Dialog>
  )
}
