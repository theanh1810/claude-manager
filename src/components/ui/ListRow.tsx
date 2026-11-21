import clsx from 'clsx'
import type { ReactNode } from 'react'

const HEIGHT = {
  edit: 'h-row-edit',
  memory: 'h-row-memory',
  session: 'h-row-session',
  'session-warn': 'h-row-session-warn',
  group: 'h-row-group',
  cleanup: 'h-row-cleanup'
} as const

export type ListRowHeight = keyof typeof HEIGHT

interface Props {
  height: ListRowHeight
  selected?: boolean
  as?: 'div' | 'button'
  id?: string
  children: ReactNode
}

/** Fixed-height row. The selected row has a 2px bar and a fill that does not change on hover, so selection is not colour alone. */
export default function ListRow({ height, selected = false, as: Tag = 'div', id, children }: Props) {
  return (
    <Tag
      id={id}
      {...(Tag === 'button' ? { type: 'button' as const } : {})}
      className={clsx(
        'relative block w-full overflow-hidden border-b border-line px-3 py-2 text-left [contain:layout_paint]',
        HEIGHT[height],
        selected ? 'bg-accent-subtle' : 'hover:bg-surface-2',
        Tag === 'button' && 'focus-inset'
      )}
    >
      {selected && <span data-selected-bar aria-hidden="true" className="absolute inset-y-0 left-0 w-0.5 bg-accent-fg" />}
      {children}
    </Tag>
  )
}
