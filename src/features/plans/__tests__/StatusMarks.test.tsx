// Approval, closed and verdict marks of the Plans tab on the StatusMark primitive (design brief S1, S2, rulings R1, R2).
// UC-003/AC-15, AC-16, AC-17 are shown by the three approval labels; AC-21 by the verdict marks.

import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { PlanApproval, PlanVerdict } from '@/types/spec'
import { ApprovalBadge, Breadcrumb, ClosedMark, VerdictMark } from '../StatusMarks'
import { colourOf, PANE, ratio, SURFACES, surface, THEMES } from './contrast'

const MIN = 4.5
// The old palette and the inverted selected-row pair are gone: a tone is a token class and carries both themes.
const OLD_PALETTE = /dark:|slate-|emerald-|rose-|amber-|\bbadge\b/

describe('contrast helper', () => {
  it('reads the pane and the selected-row fill from globals.css for each theme', () => {
    expect(PANE.light.rgb).toEqual([255, 255, 255])
    expect(PANE.dark.rgb).toEqual([13, 17, 23])
    expect(surface('accent-subtle', 'light').rgb).toEqual([238, 242, 255])
    expect(surface('accent-subtle', 'dark').rgb).toEqual([28, 35, 65])
  })

  it('resolves a token class by theme, with its opacity, and skips a class that is not a colour', () => {
    const token = document.createElement('p')
    token.className = 'text-xs text-ink-muted bg-surface-2 hover:bg-surface-3'
    expect(colourOf(token, 'text', 'dark').rgb).toEqual([157, 167, 179])
    expect(colourOf(token, 'bg', 'light').rgb).toEqual([241, 245, 249])
    const faded = document.createElement('p')
    faded.className = 'bg-accent-subtle/50'
    expect(colourOf(faded, 'bg', 'light').alpha).toBe(0.5)
    expect(() => colourOf(faded, 'text', 'light')).toThrow(/no text colour class/)
  })
})

describe('<ApprovalBadge />', () => {
  const CASES: Array<[PlanApproval, string, string]> = [
    ['approved', 'Plan đã duyệt', 'success'],
    ['not_approved', 'Plan chưa duyệt', 'warning'],
    ['stale', 'Cần duyệt lại', 'danger'],
  ]

  it.each(CASES)('UC-003 %s reads %s with an icon beside the words', (approval, text) => {
    render(<ApprovalBadge approval={approval} />)
    expect(screen.getByText(text).querySelector('svg')).not.toBeNull()
  })

  it.each(CASES)('UC-003/AC-16 %s takes the %s tone, so a stale stamp differs from a plan never approved', (approval, text, tone) => {
    render(<ApprovalBadge approval={approval} />)
    const badge = screen.getByText(text)
    expect(badge).toHaveClass(`bg-${tone}-bg`, `text-${tone}-fg`)
    expect(badge.className).not.toMatch(OLD_PALETTE)
  })

  it.each(CASES.flatMap(([approval, text]) => THEMES.map((theme) => [approval, text, theme] as const)))(
    '%s badge text reaches 4.5:1 on its fill and on surface-0, surface-1 and accent-subtle in %s',
    (approval, text, theme) => {
      render(<ApprovalBadge approval={approval} />)
      const el = screen.getByText(text)
      const fg = colourOf(el, 'text', theme)
      expect(ratio(fg, colourOf(el, 'bg', theme))).toBeGreaterThanOrEqual(MIN)
      for (const name of SURFACES) expect(ratio(fg, surface(name, theme)), name).toBeGreaterThanOrEqual(MIN)
    },
  )

  it('has no selected-row variant: the prop is gone', () => {
    // @ts-expect-error onActiveRow was removed with the inverted row
    render(<ApprovalBadge approval="stale" onActiveRow />)
    expect(screen.getByText('Cần duyệt lại').className).not.toMatch(OLD_PALETTE)
  })
})

describe('a value outside the contract', () => {
  it('an approval or verdict outside the contract renders nothing and does not throw', () => {
    const approval = 'weird' as unknown as PlanApproval
    const verdict = 'purple' as unknown as PlanVerdict
    for (const variant of ['compact', 'full'] as const) {
      const { container } = render(
        <>
          <ApprovalBadge approval={approval} />
          <VerdictMark verdict={verdict} variant={variant} />
        </>,
      )
      expect(container).toBeEmptyDOMElement()
    }
  })
})

describe('<ClosedMark />', () => {
  it('shows Đã đóng with a lock icon in the neutral tone', () => {
    render(<ClosedMark />)
    const mark = screen.getByText('Đã đóng')
    expect(mark).toHaveClass('bg-surface-2', 'text-ink-muted')
    expect(mark.className).not.toMatch(OLD_PALETTE)
    expect(mark.querySelector('svg')).not.toBeNull()
  })

  it.each(THEMES)('reaches 4.5:1 on its fill and on every surface in %s', (theme) => {
    render(<ClosedMark />)
    const el = screen.getByText('Đã đóng')
    const fg = colourOf(el, 'text', theme)
    expect(ratio(fg, colourOf(el, 'bg', theme))).toBeGreaterThanOrEqual(MIN)
    for (const name of SURFACES) expect(ratio(fg, surface(name, theme)), name).toBeGreaterThanOrEqual(MIN)
  })
})

describe('<VerdictMark />', () => {
  const CASES: Array<[PlanVerdict, string, string, string]> = [
    ['red', 'Đỏ', 'đỏ', 'danger'],
    ['yellow', 'Vàng', 'vàng', 'warning'],
    ['green', 'Xanh', 'xanh', 'success'],
  ]

  it.each(CASES)('UC-003/AC-21 compact %s is an image named "Test gần nhất: %s" with a title', (verdict, _full, word) => {
    render(<VerdictMark verdict={verdict} variant="compact" />)
    const mark = screen.getByRole('img', { name: `Test gần nhất: ${word}` })
    expect(mark).toHaveAttribute('title', `Test gần nhất: ${word}`)
    expect(mark.querySelector('svg')).not.toBeNull()
    expect(mark).not.toHaveTextContent(/\S/)
  })

  it.each(CASES)('full %s shows the word %s and an icon, so colour is never alone', (verdict, text, _word, tone) => {
    render(<VerdictMark verdict={verdict} variant="full" />)
    const mark = screen.getByText(text)
    expect(mark.querySelector('svg')).not.toBeNull()
    expect(mark).toHaveClass(`bg-${tone}-bg`, `text-${tone}-fg`)
    expect(mark.className).not.toMatch(OLD_PALETTE)
  })

  it('the three verdicts draw three different shapes', () => {
    const { container } = render(
      <>
        <VerdictMark verdict="red" variant="full" />
        <VerdictMark verdict="yellow" variant="full" />
        <VerdictMark verdict="green" variant="full" />
      </>,
    )
    const shapes = [...container.querySelectorAll('svg')].map((s) => s.innerHTML)
    expect(new Set(shapes).size).toBe(3)
  })

  it.each(CASES.flatMap(([verdict, text]) => THEMES.map((theme) => [verdict, text, theme] as const)))(
    'full %s badge text reaches 4.5:1 on its fill and on every surface in %s',
    (verdict, text, theme) => {
      render(<VerdictMark verdict={verdict} variant="full" />)
      const el = screen.getByText(text)
      const fg = colourOf(el, 'text', theme)
      expect(ratio(fg, colourOf(el, 'bg', theme))).toBeGreaterThanOrEqual(MIN)
      for (const name of SURFACES) expect(ratio(fg, surface(name, theme)), name).toBeGreaterThanOrEqual(MIN)
    },
  )

  // The compact icon sits on a tree row: the pane, a raised pane, or the selected (accent-subtle) row, which no longer inverts.
  it.each(CASES.flatMap(([verdict]) => THEMES.map((theme) => [verdict, theme] as const)))(
    'compact %s icon reaches 4.5:1 on surface-0, surface-1 and accent-subtle in %s',
    (verdict, theme) => {
      render(<VerdictMark verdict={verdict} variant="compact" />)
      const mark = screen.getByRole('img')
      expect(mark.className).not.toMatch(OLD_PALETTE)
      const fg = colourOf(mark, 'text', theme)
      for (const name of SURFACES) expect(ratio(fg, surface(name, theme)), name).toBeGreaterThanOrEqual(MIN)
    },
  )
})

describe('<Breadcrumb />', () => {
  it('is a nav named Vị trí: the project folder, the group and the current page', () => {
    render(<Breadcrumb project="/abs/claude-manager" group="Thay đổi" current="openspec-reader" />)
    const nav = screen.getByRole('navigation', { name: 'Vị trí' })
    const items = within(nav).getAllByRole('listitem')
    expect(items.map((i) => i.textContent)).toEqual(['claude-manager', 'Thay đổi', 'openspec-reader'])
    expect(items[0]).toHaveAttribute('title', '/abs/claude-manager')
    expect(items[2]).toHaveAttribute('aria-current', 'page')
    expect(items[0]).not.toHaveAttribute('aria-current')
    expect(nav.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(2)
  })

  it.each(THEMES)('reaches 4.5:1 on the pane in %s', (theme) => {
    render(<Breadcrumb project="/abs/p" group="Specs" current="x" />)
    const nav = screen.getByRole('navigation')
    expect(ratio(colourOf(nav, 'text', theme), PANE[theme])).toBeGreaterThanOrEqual(MIN)
  })
})
