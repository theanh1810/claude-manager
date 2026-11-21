import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Moon } from 'lucide-react'
import Segmented from '../Segmented'
import Switch from '../Switch'
import Checkbox from '../Checkbox'
import Input from '../Input'

const OPTIONS = [
  { value: 'all', label: 'Tất cả' },
  { value: 'memory', label: 'Memory' },
  { value: 'error', label: 'Lỗi' }
]

function Group({ disabled = false }: { disabled?: boolean }) {
  const [v, setV] = useState('all')
  return <Segmented value={v} onChange={setV} options={OPTIONS} aria-label="Loại" disabled={disabled} />
}

describe('<Segmented />', () => {
  it('is a radiogroup of radios with one checked and one tab stop', () => {
    render(<Group />)
    expect(screen.getByRole('radiogroup', { name: 'Loại' })).toBeInTheDocument()
    const radios = screen.getAllByRole('radio')
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false'])
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1])
  })

  it('arrow keys move focus and select, wrapping at both ends', async () => {
    const user = userEvent.setup()
    render(<Group />)
    await user.tab()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: 'Memory' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Memory' })).toHaveFocus()
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(screen.getByRole('radio', { name: 'Tất cả' })).toHaveAttribute('aria-checked', 'true')
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('radio', { name: 'Lỗi' })).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(screen.getByRole('radio', { name: 'Memory' })).toHaveAttribute('aria-checked', 'true')
  })

  it('Home and End jump to the first and last option', async () => {
    const user = userEvent.setup()
    render(<Group />)
    await user.tab()
    await user.keyboard('{End}')
    expect(screen.getByRole('radio', { name: 'Lỗi' })).toHaveAttribute('aria-checked', 'true')
    await user.keyboard('{Home}')
    expect(screen.getByRole('radio', { name: 'Tất cả' })).toHaveAttribute('aria-checked', 'true')
  })

  it('a click selects, and a disabled group ignores clicks', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<Group />)
    await user.click(screen.getByRole('radio', { name: 'Lỗi' }))
    expect(screen.getByRole('radio', { name: 'Lỗi' })).toHaveAttribute('aria-checked', 'true')
    unmount()
    render(<Group disabled />)
    await user.click(screen.getByRole('radio', { name: 'Lỗi' }))
    expect(screen.getByRole('radio', { name: 'Lỗi' })).toHaveAttribute('aria-checked', 'false')
  })
})

describe('<Switch />', () => {
  function Toggle(props: { loading?: boolean }) {
    const [on, setOn] = useState(false)
    return <Switch checked={on} onCheckedChange={setOn} label="Chế độ học" description="Tắt" {...props} />
  }

  it('is role switch, toggled by Space and by Enter', async () => {
    const user = userEvent.setup()
    render(<Toggle />)
    const sw = screen.getByRole('switch', { name: 'Chế độ học' })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    await user.tab()
    await user.keyboard(' ')
    expect(sw).toHaveAttribute('aria-checked', 'true')
    await user.keyboard('{Enter}')
    expect(sw).toHaveAttribute('aria-checked', 'false')
  })

  it('links its description and shows a knob position through the track classes', async () => {
    const user = userEvent.setup()
    render(<Toggle />)
    const sw = screen.getByRole('switch')
    expect(sw).toHaveAccessibleDescription('Tắt')
    expect(sw.querySelector('[data-track]')).toHaveClass('bg-line-control')
    await user.click(sw)
    expect(sw.querySelector('[data-track]')).toHaveClass('bg-accent-fg')
    expect(sw.querySelector('[data-knob]')).toHaveClass('translate-x-3')
  })

  it('loading marks it busy and ignores presses', async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    render(<Switch checked={false} onCheckedChange={onCheckedChange} label="Tạm dừng ghi nhận" loading />)
    const sw = screen.getByRole('switch')
    expect(sw).toHaveAttribute('aria-busy', 'true')
    await user.click(sw)
    expect(onCheckedChange).not.toHaveBeenCalled()
  })

  it('the icon layout keeps role switch and its name', async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    render(<Switch layout="icon" icon={Moon} checked label="Chế độ học" onCheckedChange={onCheckedChange} />)
    const sw = screen.getByRole('switch', { name: 'Chế độ học' })
    expect(sw).toHaveAttribute('aria-checked', 'true')
    await user.click(sw)
    expect(onCheckedChange).toHaveBeenCalledWith(false)
  })
})

describe('<Checkbox />', () => {
  it('stays a native checkbox that toggles', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Checkbox label="Chọn tất cả" onChange={onChange} />)
    const box = screen.getByRole('checkbox', { name: 'Chọn tất cả' })
    expect(box.tagName).toBe('INPUT')
    await user.click(box)
    expect(box).toBeChecked()
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('supports the indeterminate state', () => {
    render(<Checkbox label="Một phần" indeterminate />)
    expect(screen.getByRole('checkbox')).toBePartiallyChecked()
  })

  it('takes its name from aria-label when it has no visible label, and fails to type-check with neither', () => {
    render(<Checkbox aria-label="Chọn dòng" />)
    expect(screen.getByRole('checkbox', { name: 'Chọn dòng' })).toBeInTheDocument()
    // @ts-expect-error a checkbox needs a label or an aria-label
    render(<Checkbox />)
  })
})

describe('<Input />', () => {
  it('labels the field and fails to type-check with no label or aria-label', () => {
    render(<Input label="API key" />)
    expect(screen.getByLabelText('API key')).toBeInTheDocument()
    // @ts-expect-error an input needs a label or an aria-label
    render(<Input />)
  })

  it('an error sets aria-invalid and describes the field with the message', () => {
    render(<Input label="Số ngày" error="Phải là số" />)
    const field = screen.getByLabelText('Số ngày')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveAccessibleDescription('Phải là số')
  })

  it('a search Input clears on Esc first and blurs only on the next Esc', async () => {
    const user = userEvent.setup()
    function Search() {
      const [q, setQ] = useState('')
      return <Input type="search" aria-label="Tìm" value={q} onChange={(e) => setQ(e.target.value)} />
    }
    render(<Search />)
    const box = screen.getByRole('searchbox', { name: 'Tìm' })
    await user.type(box, 'abc')
    expect(box).toHaveValue('abc')
    await user.keyboard('{Escape}')
    expect(box).toHaveValue('')
    expect(box).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(box).not.toHaveFocus()
  })

  it('ArrowDown in a search Input moves focus to the primary list', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Input type="search" aria-label="Tìm" />
        <div data-primary-list tabIndex={0}>
          list
        </div>
      </>
    )
    await user.click(screen.getByRole('searchbox'))
    await user.keyboard('{ArrowDown}')
    expect(screen.getByText('list')).toHaveFocus()
  })

  it('a password field is never autocompleted or spell-checked', () => {
    render(<Input label="Key" type="password" />)
    const field = screen.getByLabelText('Key')
    expect(field).toHaveAttribute('autocomplete', 'off')
    expect(field).toHaveAttribute('spellcheck', 'false')
  })
})
