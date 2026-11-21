import type { ReactNode } from 'react'

/** The fixed 56px slot at the top of a list: an index or mem0 state arriving or leaving never moves the rows below it. */
export default function StatusSlot({ children }: { children: ReactNode }) {
  return <div className="h-slot shrink-0 overflow-hidden border-b border-line">{children}</div>
}
