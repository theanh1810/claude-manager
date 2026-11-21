import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode
} from 'react'
import { FixedSizeList, VariableSizeList, type ListChildComponentProps } from 'react-window'
import { useElementSize } from '@/hooks/useElementSize'
import Skeleton from './Skeleton'

export interface RowState {
  selected: boolean
  index: number
}

interface Props<T> {
  items: T[]
  getKey: (item: T) => string
  itemSize: number | ((index: number) => number)
  renderRow: (item: T, state: RowState) => ReactNode
  /** Listbox mode only; a non-selectable list ignores both. */
  selectedId?: string | null
  onSelectId?: (id: string | null) => void
  ariaLabel: string
  /** Shown instead of the rows when there are none: an EmptyState block. */
  empty?: ReactNode
  loading?: boolean
  /** Shown instead of everything else: an ErrorState block. */
  error?: ReactNode
  overscan?: number
  /** Enter on the selected row. */
  onActivate?: (id: string) => void
  /** The list `j`, `k` and `/` act on; set false for a second list on the same screen. */
  primary?: boolean
  /**
   * Default true: a listbox of options with selection that follows the keyboard (Edits, Memory).
   * False: a plain list of rows that hold their own buttons; no selection, no list keys.
   */
  selectable?: boolean
}

interface RowData {
  items: unknown[]
  getKey: (item: unknown) => string
  renderRow: (item: unknown, state: RowState) => ReactNode
  selectedId: string | null
  onSelectId: (id: string | null) => void
  selectable: boolean
}

interface ListboxContextValue {
  'aria-label': string
  'aria-activedescendant'?: string
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void
  'data-primary-list'?: true
  /** A plain list: role="list", no tab stop, no keys. */
  plain?: true
}

const ListboxContext = createContext<ListboxContextValue | null>(null)

/** react-window's scroll container, turned into the listbox: one tab stop, no outline of its own (the selected row shows the ring). */
const Listbox = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function Listbox(props, ref) {
  const aria = useContext(ListboxContext)
  if (aria?.plain) return <div ref={ref} role="list" aria-label={aria['aria-label']} {...props} />
  return <div ref={ref} role="listbox" tabIndex={0} {...aria} {...props} />
})

function Row({ index, style, data }: ListChildComponentProps<RowData>) {
  const item = data.items[index]
  const id = data.getKey(item)
  if (!data.selectable) {
    return (
      <div role="listitem" aria-setsize={data.items.length} aria-posinset={index + 1} style={style}>
        {data.renderRow(item, { selected: false, index })}
      </div>
    )
  }
  const selected = id === data.selectedId
  return (
    <div
      role="option"
      id={`opt-${id}`}
      aria-selected={selected}
      aria-setsize={data.items.length}
      aria-posinset={index + 1}
      style={style}
      onMouseDown={(e) => e.currentTarget.closest<HTMLElement>('[role="listbox"]')?.focus()}
      onClick={() => data.onSelectId(id)}
    >
      {data.renderRow(item, { selected, index })}
    </div>
  )
}

const MAX_SKELETON_ROWS = 8
const NO_SELECT = () => {}

/** Windowed listbox with selection that follows the keyboard, or with `selectable={false}` a plain list. Loading, empty and error each replace the rows. */
export default function VirtualList<T>({
  items,
  getKey,
  itemSize,
  renderRow,
  selectedId = null,
  onSelectId = NO_SELECT,
  ariaLabel,
  empty,
  loading = false,
  error,
  overscan = 6,
  onActivate,
  primary = true,
  selectable = true
}: Props<T>) {
  const [box, { height }] = useElementSize<HTMLDivElement>()
  const list = useRef<FixedSizeList | VariableSizeList | null>(null)
  const sizeAt = (i: number) => (typeof itemSize === 'number' ? itemSize : itemSize(i))
  const index = selectedId === null ? -1 : items.findIndex((item) => getKey(item) === selectedId)

  useEffect(() => {
    if (index >= 0) list.current?.scrollToItem(index, 'smart')
  }, [index])
  useEffect(() => {
    if (list.current instanceof VariableSizeList) list.current.resetAfterIndex(0)
  }, [items, itemSize])

  const move = (to: number) => {
    const at = Math.max(0, Math.min(items.length - 1, to))
    const id = getKey(items[at])
    if (id !== selectedId) onSelectId(id)
    list.current?.scrollToItem(at, 'smart')
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (items.length === 0) return
    const page = Math.max(1, Math.floor(height / sizeAt(Math.max(0, index))))
    switch (e.key) {
      case 'ArrowDown':
        move(index < 0 ? 0 : index + 1)
        break
      case 'ArrowUp':
        move(index < 0 ? 0 : index - 1)
        break
      case 'PageDown':
        move(index < 0 ? 0 : index + page)
        break
      case 'PageUp':
        move(index < 0 ? 0 : index - page)
        break
      case 'Home':
        move(0)
        break
      case 'End':
        move(items.length - 1)
        break
      case 'Enter':
        if (selectedId !== null && index >= 0) onActivate?.(selectedId)
        break
      default:
        return
    }
    e.preventDefault()
  }

  const listbox = useMemo<ListboxContextValue>(
    () =>
      selectable
        ? {
            'aria-label': ariaLabel,
            'aria-activedescendant': index >= 0 ? `opt-${selectedId}` : undefined,
            onKeyDown,
            'data-primary-list': primary ? true : undefined
          }
        : { 'aria-label': ariaLabel, plain: true },
    // onKeyDown closes over the current list state; rebuilding with it keeps the keys in step
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ariaLabel, index, selectedId, primary, items, height, onActivate, onSelectId, selectable]
  )

  // The cast is the one place the row type is forgotten: Row only passes items back through the same getKey and renderRow.
  const itemData = { items, getKey, renderRow, selectedId, onSelectId, selectable } as unknown as RowData
  const common = {
    height,
    width: '100%',
    itemCount: items.length,
    itemData,
    overscanCount: overscan,
    outerElementType: Listbox,
    itemKey: (i: number) => getKey(items[i])
  }

  let body: ReactNode = null
  if (error) body = error
  else if (loading) {
    body = <Skeleton.Rows count={Math.min(MAX_SKELETON_ROWS, Math.max(1, Math.ceil(height / sizeAt(0))))} height={sizeAt(0)} />
  } else if (items.length === 0) body = empty
  else if (height > 0) {
    body = (
      <ListboxContext.Provider value={listbox}>
        {typeof itemSize === 'number' ? (
          <FixedSizeList {...common} itemSize={itemSize} ref={(r) => void (list.current = r)}>
            {Row}
          </FixedSizeList>
        ) : (
          <VariableSizeList {...common} itemSize={itemSize} ref={(r) => void (list.current = r)}>
            {Row}
          </VariableSizeList>
        )}
      </ListboxContext.Provider>
    )
  }

  return (
    <div ref={box} className="min-h-0 flex-1">
      {body}
    </div>
  )
}
