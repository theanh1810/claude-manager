import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Menu, { type MenuItem } from '../Menu'

function setup(overrides: Partial<Record<string, Partial<MenuItem>>> = {}) {
  const onSelect = vi.fn()
  const items: MenuItem[] = [
    { id: 'all', label: 'Tất cả', checked: false, onSelect: () => onSelect('all'), ...overrides.all },
    { id: 'alpha', label: 'Alpha', checked: true, onSelect: () => onSelect('alpha'), ...overrides.alpha },
    { id: 'beta', label: 'Beta', checked: false, disabled: true, onSelect: () => onSelect('beta'), ...overrides.beta },
    { id: 'gamma', label: 'Gamma', checked: false, onSelect: () => onSelect('gamma'), ...overrides.gamma },
    { id: 'add', label: 'Thêm project…', separatorBefore: true, onSelect: () => onSelect('add'), ...overrides.add }
  ]
  render(
    <>
      <button>trước</button>
      <Menu label="Project" items={items} renderTrigger={(p) => <button {...p}>Project: Alpha</button>} />
      <button>sau</button>
    </>
  )
  return { onSelect, user: userEvent.setup(), trigger: screen.getByRole('button', { name: 'Project: Alpha' }) }
}

const active = () => {
  const id = screen.getByRole('menu').getAttribute('aria-activedescendant')
  return id ? document.getElementById(id)?.textContent : null
}

describe('<Menu />', () => {
  it('opens from its button with aria-haspopup and aria-expanded', async () => {
    const { user, trigger } = setup()
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).toBeNull()
    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menu', { name: 'Project' })).toHaveFocus()
  })

  it('opens on ArrowDown at the checked item, radio items expose aria-checked', async () => {
    const { user, trigger } = setup()
    trigger.focus()
    await user.keyboard('{ArrowDown}')
    expect(active()).toBe('Alpha')
    const radios = screen.getAllByRole('menuitemradio')
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false', 'false'])
    expect(screen.getByRole('menuitem', { name: 'Thêm project…' })).toBeInTheDocument()
  })

  it('moves with the arrow keys, Home and End, wraps, and skips a disabled item', async () => {
    const { user, trigger } = setup()
    await user.click(trigger)
    await user.keyboard('{ArrowDown}')
    expect(active()).toBe('Gamma')
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(active()).toBe('Tất cả')
    await user.keyboard('{ArrowUp}')
    expect(active()).toBe('Thêm project…')
    await user.keyboard('{Home}')
    expect(active()).toBe('Tất cả')
    await user.keyboard('{End}')
    expect(active()).toBe('Thêm project…')
  })

  it('a typed letter jumps to the next item that starts with it', async () => {
    const { user, trigger } = setup()
    await user.click(trigger)
    await user.keyboard('g')
    expect(active()).toBe('Gamma')
    await user.keyboard('t')
    expect(active()).toBe('Thêm project…')
  })

  it('selects with Enter, closes and returns focus to the button', async () => {
    const { user, trigger, onSelect } = setup()
    await user.click(trigger)
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onSelect).toHaveBeenCalledWith('gamma')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(trigger).toHaveFocus()
  })

  it('selects with Space', async () => {
    const { user, trigger, onSelect } = setup()
    await user.click(trigger)
    await user.keyboard('{Home} ')
    expect(onSelect).toHaveBeenCalledWith('all')
    expect(trigger).toHaveFocus()
  })

  it('does not select a disabled item', async () => {
    const { user, trigger, onSelect } = setup()
    await user.click(trigger)
    await user.click(screen.getByRole('menuitemradio', { name: 'Beta' }))
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('a click on an item selects it', async () => {
    const { user, trigger, onSelect } = setup()
    await user.click(trigger)
    await user.click(screen.getByRole('menuitem', { name: 'Thêm project…' }))
    expect(onSelect).toHaveBeenCalledWith('add')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes on Esc and returns focus to the button', async () => {
    const { user, trigger, onSelect } = setup()
    await user.click(trigger)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(trigger).toHaveFocus()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('closes on Tab and returns focus to the button', async () => {
    const { user, trigger } = setup()
    await user.click(trigger)
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(trigger).toHaveFocus()
    await user.keyboard('{Tab}')
    expect(screen.getByRole('button', { name: 'sau' })).toHaveFocus()
  })

  it('closes on a click outside without selecting anything', async () => {
    const { user, trigger, onSelect } = setup()
    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: 'sau' }))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('marks the checked item with a tick, not colour alone', async () => {
    const { user, trigger } = setup()
    await user.click(trigger)
    expect(screen.getByRole('menuitemradio', { name: 'Alpha' }).querySelector('svg')).not.toBeNull()
    expect(screen.getByRole('menuitemradio', { name: 'Gamma' }).querySelector('svg')).toBeNull()
  })
})
