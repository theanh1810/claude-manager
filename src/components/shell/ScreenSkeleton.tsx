import Skeleton from '@/components/ui/Skeleton'
import type { ScreenKey } from '@/lib/navigation'

/** Row height of the list column of each screen, so the real list does not shift the layout. */
const LIST_ROW: Partial<Record<ScreenKey, number>> = { edits: 72, history: 72, memory: 56, plans: 36 }

interface Props {
  screen: ScreenKey
  /** False when the real header is already on screen (the app frame renders it outside Suspense). */
  withHeader?: boolean
}

/** The Suspense fallback of a lazy screen, with the header and column sizes of the real one. */
export default function ScreenSkeleton({ screen, withHeader = true }: Props) {
  const rowHeight = LIST_ROW[screen]
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {withHeader && (
        <div data-skeleton-header className="flex h-header shrink-0 items-center border-b border-line bg-surface-0 px-4">
          <Skeleton className="h-5 w-40" />
        </div>
      )}
      {rowHeight ? (
        <div className="flex min-h-0 flex-1">
          <div data-skeleton-list className="w-pane shrink-0 border-r border-line">
            <Skeleton.Rows count={8} height={rowHeight} />
          </div>
          <div className="min-w-0 flex-1 p-4">
            <Skeleton.Block height={108} />
          </div>
        </div>
      ) : (
        <div data-skeleton-column className="min-w-0 flex-1 p-4">
          <Skeleton.Rows count={6} height={64} />
        </div>
      )}
    </div>
  )
}
