import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState, type ReactNode } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import VirtualList from '../VirtualList'
import ListRow from '../ListRow'

interface Item {
  id: string
  name: string
}
const items = (n: number): Item[] => Array.from({ length: n }, (_, i) => ({ id: `item-${i}`, name: `Dòng ${i}` }))

// jsdom has no layout: give every element the same fixed 400x600 box.
const realRect = HTMLElement.prototype.getBoundingClientRect
beforeEach(() => {
  HTMLElement.prototype.getBoundingClientRect = () => ({ width: 400, height: 600, top: 0, left: 0, right: 400, bottom: 600, x: 0, y: 0, toJSON: () => ({}) })
})
afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect = realRect
})

function Harness(props: {
  data: Item[]
  initial?: string | null
  loading?: boolean
  empty?: ReactNode
  error?: ReactNode
  onActivate?: (id: string) => void
  onSelect?: (id: string | null) => void
}) {
  const [sel, setSel] = useState<string | null>(props.initial ?? null)
  return (
    <div style={{ height: 600 }}>
      <VirtualList
        items={props.data}
        getKey={(i) => i.id}
        itemSize={72}
        ariaLabel="Danh sách thay đổi"
        selectedId={sel}
        onSelectId={(id) => {
          setSel(id)
          props.onSelect?.(id)
        }}
        onActivate={props.onActivate}
        loading={props.loading}
        empty={props.empty}
        error={props.error}
        renderRow={(item, s) => (
          <ListRow height="edit" selected={s.selected}>
            {item.name}
          </ListRow>
        )}
      />
    </div>
  )
}

const active = () => screen.getByRole('listbox').getAttribute('aria-activedescendant')

describe('<VirtualList />', () => {
  it('a list of 5000 items in a 600px box renders at most 40 row nodes', () => {
    render(<Harness data={items(5000)} />)
    const rows = screen.getAllByRole('option')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThanOrEqual(40)
  })

  it('is one listbox tab stop and every row carries selection and position', () => {
    render(<Harness data={items(5000)} initial="item-2" />)
    const box = screen.getByRole('listbox', { name: 'Danh sách thay đổi' })
    expect(box.tabIndex).toBe(0)
    expect(box).toHaveAttribute('aria-activedescendant', 'opt-item-2')
    const rows = screen.getAllByRole('option')
    rows.forEach((r) => {
      expect(r).toHaveAttribute('aria-selected')
      expect(r).toHaveAttribute('aria-setsize', '5000')
      expect(r).toHaveAttribute('aria-posinset')
      expect(r.tabIndex).toBe(-1)
    })
    expect(rows.find((r) => r.id === 'opt-item-2')).toHaveAttribute('aria-selected', 'true')
    expect(rows[0]).toHaveAttribute('aria-posinset', '1')
  })

  it('arrow keys move the selection, starting at the first row when nothing is selected', async () => {
    const user = userEvent.setup()
    render(<Harness data={items(50)} />)
    screen.getByRole('listbox').focus()
    await user.keyboard('{ArrowDown}')
    expect(active()).toBe('opt-item-0')
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(active()).toBe('opt-item-2')
    await user.keyboard('{ArrowUp}')
    expect(active()).toBe('opt-item-1')
  })

  it('does not run past either end', async () => {
    const user = userEvent.setup()
    render(<Harness data={items(3)} initial="item-0" />)
    screen.getByRole('listbox').focus()
    await user.keyboard('{ArrowUp}')
    expect(active()).toBe('opt-item-0')
    await user.keyboard('{End}{ArrowDown}')
    expect(active()).toBe('opt-item-2')
  })

  it('Home, End, PageDown and PageUp jump, and the target row is rendered', async () => {
    const user = userEvent.setup()
    render(<Harness data={items(5000)} initial="item-100" />)
    screen.getByRole('listbox').focus()
    await user.keyboard('{End}')
    expect(active()).toBe('opt-item-4999')
    expect(document.getElementById('opt-item-4999')).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Home}')
    expect(active()).toBe('opt-item-0')
    await user.keyboard('{PageDown}')
    expect(active()).toBe('opt-item-8')
    await user.keyboard('{PageUp}')
    expect(active()).toBe('opt-item-0')
  })

  it('Enter activates the selected row and does nothing with no selection', async () => {
    const user = userEvent.setup()
    const onActivate = vi.fn()
    render(<Harness data={items(5)} onActivate={onActivate} />)
    screen.getByRole('listbox').focus()
    await user.keyboard('{Enter}')
    expect(onActivate).not.toHaveBeenCalled()
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onActivate).toHaveBeenCalledWith('item-0')
  })

  it('a click selects the row and gives focus to the listbox', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<Harness data={items(5)} onSelect={onSelect} />)
    await user.click(screen.getByText('Dòng 3'))
    expect(onSelect).toHaveBeenCalledWith('item-3')
    expect(screen.getByRole('listbox')).toHaveFocus()
  })

  it('a loading list shows skeleton rows instead of the rows', () => {
    render(<Harness data={items(50)} loading />)
    expect(screen.queryByRole('option')).toBeNull()
    expect(screen.getByText('Đang tải…')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-skeleton-row]')).toHaveLength(8)
  })

  it('an empty list shows its empty state, an error replaces everything', () => {
    const { rerender } = render(<Harness data={[]} empty={<p>Không còn thay đổi nào</p>} />)
    expect(screen.getByText('Không còn thay đổi nào')).toBeInTheDocument()
    expect(screen.queryByRole('listbox')).toBeNull()
    rerender(<Harness data={items(5)} loading error={<p role="alert">Không tải được</p>} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Không tải được')
    expect(screen.queryByRole('option')).toBeNull()
    expect(screen.queryByText('Đang tải…')).toBeNull()
  })

  it('keys on an empty list do nothing', () => {
    render(<Harness data={[]} empty={<p>trống</p>} />)
    fireEvent.keyDown(document.body, { key: 'ArrowDown' })
    expect(screen.getByText('trống')).toBeInTheDocument()
  })
})

describe('<ListRow />', () => {
  it('uses the height constant of its kind and marks the selected row with a bar and a fill', () => {
    const { container, rerender } = render(<ListRow height="memory">a</ListRow>)
    expect(container.firstElementChild).toHaveClass('h-row-memory', 'border-b')
    expect(container.querySelector('[data-selected-bar]')).toBeNull()
    rerender(
      <ListRow height="session-warn" selected>
        a
      </ListRow>
    )
    expect(container.firstElementChild).toHaveClass('h-row-session-warn', 'bg-accent-subtle')
    expect(container.querySelector('[data-selected-bar]')).toHaveClass('w-0.5', 'bg-accent-fg')
  })

  it('can render as a button', () => {
    render(
      <ListRow height="group" as="button">
        Nhóm
      </ListRow>
    )
    expect(screen.getByRole('button', { name: 'Nhóm' })).toHaveAttribute('type', 'button')
  })
})

describe('<VirtualList selectable={false} />', () => {
  it('selectable={false} renders a list without selection or list keys', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(
      <div style={{ height: 600 }}>
        <VirtualList
          items={items(30)}
          getKey={(i) => i.id}
          itemSize={72}
          ariaLabel="Danh sách hàng"
          selectable={false}
          onSelectId={onSelect}
          renderRow={(item) => <ListRow height="edit">{item.name}</ListRow>}
        />
      </div>
    )
    const list = screen.getByRole('list', { name: 'Danh sách hàng' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(list).not.toHaveAttribute('tabindex')
    expect(list).not.toHaveAttribute('aria-activedescendant')
    expect(list).not.toHaveAttribute('data-primary-list')
    const rows = screen.getAllByRole('listitem')
    expect(rows[0]).toHaveAttribute('aria-setsize', '30')
    expect(rows[0]).toHaveAttribute('aria-posinset', '1')
    expect(rows[0]).not.toHaveAttribute('aria-selected')
    list.focus()
    await user.keyboard('{ArrowDown}')
    await user.click(rows[1])
    expect(onSelect).not.toHaveBeenCalled()
    expect(document.querySelector('[aria-selected="true"]')).toBeNull()
  })
})

