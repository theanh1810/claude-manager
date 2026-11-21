import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import ConfirmDialog, { type ConfirmDialogProps } from './ConfirmDialog'

export type ConfirmOptions = Omit<ConfirmDialogProps, 'onConfirm' | 'onCancel' | 'busy' | 'error'>

interface Request {
  id: number
  options: ConfirmOptions
  resolve: (confirmed: boolean) => void
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<Confirm | null>(null)

/** One confirmation at a time, first come first served. Mounted once above the app. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Request[]>([])
  const nextId = useRef(0)
  const settled = useRef(-1)

  const confirm = useCallback<Confirm>(
    (options) => new Promise<boolean>((resolve) => setQueue((q) => [...q, { id: nextId.current++, options, resolve }])),
    []
  )

  const current = queue[0]
  const settle = (confirmed: boolean) => {
    if (!current || settled.current === current.id) return
    settled.current = current.id
    current.resolve(confirmed)
    setQueue((q) => q.slice(1))
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {current && <ConfirmDialog key={current.id} {...current.options} onConfirm={() => settle(true)} onCancel={() => settle(false)} />}
    </ConfirmContext.Provider>
  )
}

/** `await confirm({...})` is true only when the user pressed the confirm button. */
// eslint-disable-next-line react-refresh/only-export-components -- the hook and its provider belong together
export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext)
  if (!confirm) throw new Error('useConfirm needs a <ConfirmProvider> above it')
  return confirm
}
