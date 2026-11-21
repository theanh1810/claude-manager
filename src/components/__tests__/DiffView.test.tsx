import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { DiffMethod } from 'react-diff-viewer-continued'
import DiffView from '../DiffView'

// The library stays real; the spy only records the props DiffView passes to it.
const viewer = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }))
vi.mock('react-diff-viewer-continued', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-diff-viewer-continued')>()
  const Real = actual.default
  return {
    ...actual,
    default: (props: ComponentProps<typeof Real>) => {
      viewer.props.push(props as unknown as Record<string, unknown>)
      return <Real {...props} />
    }
  }
})

const lines = (n: number, replace?: { at: number; text: string }) =>
  Array.from({ length: n }, (_, i) => (replace && i + 1 === replace.at ? replace.text : `line${i + 1}`)).join('\n')

const SAVED_MATCH_MEDIA = window.matchMedia

let rectSpy: { mockRestore: () => void } | null = null
function widthOf(px: number) {
  rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: px, height: 400, top: 0, left: 0, right: px, bottom: 400, x: 0, y: 0, toJSON: () => ({}) })
}

beforeEach(() => {
  localStorage.clear()
  viewer.props.length = 0
})
afterEach(() => {
  // Not vi.restoreAllMocks(): it would also empty the matchMedia stub of src/test/setup.ts.
  rectSpy?.mockRestore()
  rectSpy = null
  window.matchMedia = SAVED_MATCH_MEDIA
})

describe('DiffView', () => {
  it('has no banner landmark inside and no unnamed button: the library summary bar is hidden', async () => {
    const { container } = render(<DiffView before={'a\nb\nc'} after={'a\nx\nc'} />)
    await screen.findAllByText('x')
    expect(container.querySelector('[role="banner"]')).toBeNull()
    for (const button of screen.queryAllByRole('button')) expect(button).toHaveAccessibleName()
  })

  it('UC-001/AC-1 a file change shows its diff: only changed lines with 3 lines of context by default', async () => {
    render(<DiffView before={lines(20)} after={lines(20, { at: 10, text: 'edited' })} />)
    await screen.findAllByText('line7')
    for (const kept of ['line7', 'line8', 'line9', 'line11', 'line12', 'line13']) expect(screen.getAllByText(kept).length).toBeGreaterThan(0)
    for (const folded of ['line1', 'line6', 'line14', 'line20']) expect(screen.queryByText(folded)).toBeNull()
    expect(screen.getByRole('button', { name: 'Hiện 6 dòng không đổi' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hiện 7 dòng không đổi' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Chỉ dòng thay đổi' })).toHaveAttribute('aria-checked', 'true')
  })

  it('the fold button opens its lines from the keyboard', async () => {
    const user = userEvent.setup()
    render(<DiffView before={lines(20)} after={lines(20, { at: 10, text: 'edited' })} />)
    const fold = await screen.findByRole('button', { name: 'Hiện 6 dòng không đổi' })
    fold.focus()
    await user.keyboard('{Enter}')
    expect((await screen.findAllByText('line1')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Hiện 6 dòng không đổi' })).toBeNull()
  })

  it('the fold row is not a second tab stop beside its button', async () => {
    const { container } = render(<DiffView before={lines(20)} after={lines(20, { at: 10, text: 'edited' })} />)
    await screen.findByRole('button', { name: 'Hiện 6 dòng không đổi' })
    expect(container.querySelector('tr[role="button"]')).toBeNull()
    expect(container.querySelector('tr[tabindex]')).toBeNull()
  })

  it('turning off "Chỉ dòng thay đổi" shows every line and the choice is kept in cm.diffChangedOnly', async () => {
    const props = { before: lines(20), after: lines(20, { at: 10, text: 'edited' }) }
    const { unmount } = render(<DiffView {...props} />)
    fireEvent.click(screen.getByRole('switch', { name: 'Chỉ dòng thay đổi' }))
    expect((await screen.findAllByText('line1')).length).toBeGreaterThan(0)
    expect(localStorage.getItem('cm.diffChangedOnly')).toBe('0')
    unmount()
    render(<DiffView {...props} />)
    expect(screen.getByRole('switch', { name: 'Chỉ dòng thay đổi' })).toHaveAttribute('aria-checked', 'false')
    expect((await screen.findAllByText('line1')).length).toBeGreaterThan(0)
  })

  it('the view is Chia đôi at 640px or wider, with the columns Trước and Sau', () => {
    widthOf(900)
    render(<DiffView before={'a\nb'} after={'a\nc'} />)
    expect(screen.getByRole('radio', { name: 'Chia đôi' })).toBeChecked()
    expect(screen.getByText('Trước')).toBeInTheDocument()
    expect(screen.getByText('Sau')).toBeInTheDocument()
  })

  it('the view follows the width to Gộp below 640px, with no column titles, until the user chooses', () => {
    widthOf(500)
    render(<DiffView before={'a\nb'} after={'a\nc'} />)
    expect(screen.getByRole('radio', { name: 'Gộp' })).toBeChecked()
    expect(screen.queryByText('Trước')).toBeNull()
    expect(localStorage.getItem('cm.diffView')).toBeNull()
  })

  it('a chosen view is kept in cm.diffView and wins over the width on the next opening', () => {
    widthOf(500)
    const { unmount } = render(<DiffView before={'a\nb'} after={'a\nc'} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Chia đôi' }))
    expect(localStorage.getItem('cm.diffView')).toBe('split')
    expect(screen.getByText('Trước')).toBeInTheDocument()
    unmount()
    render(<DiffView before={'a\nb'} after={'a\nc'} />)
    expect(screen.getByRole('radio', { name: 'Chia đôi' })).toBeChecked()
  })

  it('a file of 2000 lines diffs by word, one of 2001 lines by line', () => {
    render(<DiffView before={lines(2000)} after={lines(2000, { at: 5, text: 'x' })} />)
    expect(viewer.props.at(-1)?.compareMethod).toBe(DiffMethod.WORDS)
    viewer.props.length = 0
    render(<DiffView before={lines(2001)} after={lines(2001, { at: 5, text: 'x' })} />)
    expect(viewer.props.at(-1)?.compareMethod).toBe(DiffMethod.LINES)
  })

  it('colours come from the diff tokens in both theme blocks', () => {
    render(<DiffView before={'a'} after={'b'} />)
    const styles = viewer.props.at(-1)?.styles as { variables: Record<'light' | 'dark', Record<string, string>> }
    for (const theme of ['light', 'dark'] as const) {
      expect(styles.variables[theme].addedBackground).toBe('rgb(var(--diff-add-bg))')
      expect(styles.variables[theme].removedBackground).toBe('rgb(var(--diff-del-bg))')
      expect(styles.variables[theme].wordAddedBackground).toBe('rgb(var(--diff-add-word))')
    }
    expect(JSON.stringify(styles)).not.toMatch(/#[0-9a-f]{3,6}\b/i)
  })

  it('an OS theme change restyles the open diff without a remount', () => {
    let dark = false
    const listeners = new Set<() => void>()
    window.matchMedia = ((query: string) => ({
      get matches() {
        return query.includes('dark') && dark
      },
      media: query,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn)
    })) as unknown as typeof window.matchMedia
    render(<DiffView before={'a'} after={'b'} />)
    expect(viewer.props.at(-1)?.useDarkTheme).toBe(false)
    act(() => {
      dark = true
      listeners.forEach((fn) => fn())
    })
    expect(viewer.props.at(-1)?.useDarkTheme).toBe(true)
  })
})
