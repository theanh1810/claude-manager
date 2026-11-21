// Shell chrome: ScreenHeader, SkipLink, ScreenSkeleton and the shortcut sheet.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'

import ScreenHeader from '../ScreenHeader'
import ScreenSkeleton from '../ScreenSkeleton'
import ShortcutSheet from '../ShortcutSheet'
import SkipLink from '../SkipLink'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ScreenHeader', () => {
  it('is 48px with one focusable h1 and a 16px subtitle line that stays when there is no subtitle', () => {
    const ref = createRef<HTMLHeadingElement>()
    const { container, rerender } = render(<ScreenHeader title="Chờ duyệt" subtitle="3 thay đổi chờ duyệt" headingRef={ref} />)
    const h1 = screen.getByRole('heading', { level: 1, name: 'Chờ duyệt' })
    expect(h1).toHaveAttribute('tabindex', '-1')
    expect(ref.current).toBe(h1)
    expect(container.querySelector('header')).toHaveClass('h-header')
    expect(screen.getByText('3 thay đổi chờ duyệt')).toHaveClass('h-4')
    h1.focus()
    expect(h1).toHaveFocus()

    rerender(<ScreenHeader title="Chờ duyệt" />)
    expect(container.querySelector('header p')).toHaveClass('h-4')
    expect(container.querySelector('header p')).toBeEmptyDOMElement()
  })

  it('renders the screen actions on the right', () => {
    render(<ScreenHeader title="Plans" actions={<button>Làm mới</button>} />)
    expect(screen.getByRole('button', { name: 'Làm mới' })).toBeInTheDocument()
  })
})

describe('SkipLink', () => {
  it('is the first focusable element and moves focus to main', async () => {
    const user = userEvent.setup()
    render(
      <>
        <SkipLink />
        <button>Sidebar</button>
        <main id="main" tabIndex={-1}>
          <button>In main</button>
        </main>
      </>
    )
    await user.tab()
    const link = screen.getByRole('link', { name: 'Bỏ qua tới nội dung chính' })
    expect(link).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('main')).toHaveFocus()
  })
})

describe('ScreenSkeleton', () => {
  const rows = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('[data-skeleton-row]'))

  it('keeps the 48px header and the 320px list column of Chờ duyệt and Đã xử lý with 72px rows', () => {
    for (const screenKey of ['edits', 'history'] as const) {
      const { container, unmount } = render(<ScreenSkeleton screen={screenKey} />)
      expect(container.querySelector('[data-skeleton-header]')).toHaveClass('h-header')
      expect(container.querySelector('[data-skeleton-list]')).toHaveClass('w-pane')
      expect(rows(container)[0].style.height).toBe('72px')
      unmount()
    }
  })

  it('uses 56px rows for Memory & lỗi, a tree row for Plans and one column for Sessions and Dọn dẹp', () => {
    const memory = render(<ScreenSkeleton screen="memory" />)
    expect(rows(memory.container)[0].style.height).toBe('56px')
    expect(memory.container.querySelector('[data-skeleton-list]')).toHaveClass('w-pane')
    memory.unmount()
    const plans = render(<ScreenSkeleton screen="plans" />)
    expect(rows(plans.container)[0].style.height).toBe('36px')
    plans.unmount()
    for (const screenKey of ['sessions', 'cleanup'] as const) {
      const { container, unmount } = render(<ScreenSkeleton screen={screenKey} />)
      expect(container.querySelector('[data-skeleton-list]')).toBeNull()
      expect(container.querySelector('[data-skeleton-column]')).not.toBeNull()
      unmount()
    }
  })

  it('leaves the header out when the real header is already on screen', () => {
    const { container } = render(<ScreenSkeleton screen="edits" withHeader={false} />)
    expect(container.querySelector('[data-skeleton-header]')).toBeNull()
    expect(container.querySelector('[data-skeleton-list]')).not.toBeNull()
  })
})

describe('ShortcutSheet', () => {
  const KEYS = ['A', 'R', 'J', 'K', '↑', '↓', 'Enter', '/', '1–6', 'B', ',', '?', '.', 'L']

  it('lists every key of the shortcut map under three groups, with the Ctrl and Shift words off macOS', () => {
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('Win32')
    render(<ShortcutSheet open onClose={() => {}} />)
    const dialog = screen.getByRole('dialog', { name: 'Phím tắt' })
    expect(within(dialog).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Duyệt thay đổi', 'Điều hướng', 'Ghi nhận'])
    const text = dialog.textContent ?? ''
    for (const k of KEYS) expect(text).toContain(k)
    expect(within(dialog).getAllByText('Ctrl').length).toBe(5)
    expect(within(dialog).getAllByText('Shift').length).toBe(1)
    expect(within(dialog).getByText('A và R chỉ hoạt động ở màn Chờ duyệt và khi bạn không đang gõ.')).toBeInTheDocument()
  })

  it('shows the command and shift symbols on macOS', () => {
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel')
    render(<ShortcutSheet open onClose={() => {}} />)
    const dialog = screen.getByRole('dialog', { name: 'Phím tắt' })
    expect(within(dialog).getAllByText('⌘').length).toBe(5)
    expect(within(dialog).getAllByText('⇧').length).toBe(1)
  })

  it('closes from the Đóng button', async () => {
    const onClose = vi.fn()
    render(<ShortcutSheet open onClose={onClose} />)
    const dialog = screen.getByRole('dialog', { name: 'Phím tắt' })
    await userEvent.setup().click(within(dialog).getAllByRole('button', { name: 'Đóng' }).at(-1)!)
    expect(onClose).toHaveBeenCalled()
  })
})
