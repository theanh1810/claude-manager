import clsx from 'clsx'
import { ChevronRight } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'

interface Props {
  title: ReactNode
  count?: number
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** The heading level that wraps the button, so the page outline stays honest. */
  level: 2 | 3 | 4 | 5 | 6
  /** End of the header row, e.g. "4 mục · 2 KB". */
  aside?: ReactNode
  /** Panel becomes a labelled region: for long documents, not for short lists. */
  region?: boolean
  children: ReactNode
}

/** Button inside a heading; a closed panel renders no children at all, so a hidden document costs nothing. */
export default function Disclosure({ title, count, defaultOpen = false, open, onOpenChange, level, aside, region = false, children }: Props) {
  const [inner, setInner] = useState(defaultOpen)
  const buttonId = useId()
  const panelId = useId()
  const isOpen = open ?? inner
  const Heading = `h${level}` as 'h2'

  const toggle = () => {
    onOpenChange?.(!isOpen)
    if (open === undefined) setInner(!isOpen)
  }

  return (
    <div>
      <Heading className="m-0">
        <button
          type="button"
          id={buttonId}
          aria-expanded={isOpen}
          aria-controls={isOpen ? panelId : undefined}
          onClick={toggle}
          className="focus-inset flex h-8 w-full items-center gap-1.5 px-3 text-left text-sm font-semibold text-ink hover:bg-surface-2"
        >
          <ChevronRight
            aria-hidden
            size={16}
            className={clsx('shrink-0 text-ink-muted transition-transform duration-fast ease-standard', isOpen && 'rotate-90')}
          />
          {title}
          {count !== undefined && <span className="text-xs font-normal tabular-nums text-ink-subtle">({count})</span>}
          {aside && <span className="ml-auto text-xs font-normal text-ink-subtle">{aside}</span>}
        </button>
      </Heading>
      {isOpen && (
        <div id={panelId} role={region ? 'region' : undefined} aria-labelledby={region ? buttonId : undefined}>
          {children}
        </div>
      )}
    </div>
  )
}
