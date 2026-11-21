import clsx from 'clsx'

interface BarProps {
  height?: number
  width?: number
  className?: string
}

/** One pulsing bar. The size must equal the real content's, so nothing shifts when data arrives. */
function Bar({ height, width, className }: BarProps) {
  return (
    <div
      aria-hidden="true"
      className={clsx('animate-pulse-soft rounded-md bg-surface-2', className)}
      style={{ height, width }}
    />
  )
}

function Busy({ children }: { children: React.ReactNode }) {
  return (
    <div aria-busy="true">
      <span className="sr-only">Đang tải…</span>
      {children}
    </div>
  )
}

/** `count` list rows of `height` px, the loading state of a list. */
function Rows({ count, height }: { count: number; height: number }) {
  return (
    <Busy>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          data-skeleton-row
          aria-hidden="true"
          className="flex flex-col justify-center gap-2 border-b border-line px-3"
          style={{ height }}
        >
          <Bar className="h-3 w-3/5" />
          <Bar className="h-2 w-2/5" />
        </div>
      ))}
    </Busy>
  )
}

/** One block of `height` px, e.g. the 108px detail header. */
function Block({ height, width }: { height: number; width?: number }) {
  return (
    <Busy>
      <div data-skeleton-block aria-hidden="true" className="animate-pulse-soft rounded-md bg-surface-2" style={{ height, width }} />
    </Busy>
  )
}

const Skeleton = Object.assign(Bar, { Rows, Block })
export default Skeleton
