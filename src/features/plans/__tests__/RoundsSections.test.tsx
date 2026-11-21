// Review rounds, test rounds and the raw-file fallback (design brief S2 "Review", "Test", fallback).
// UC-003/AC-20..AC-23.

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { PlanErrorsOk, PlanReviewOk, PlanSection } from '@/types/spec'
import { ErrorRounds, RawFallback, ReviewRounds } from '../RoundsSections'
import { colourOf, PANE, ratio, THEMES } from './contrast'

const REVIEW: PlanSection<PlanReviewOk> = {
  state: 'ok',
  rounds: [
    { n: 2, kind: 'code', markdown: '\nVerdict: **green**\n\nNội dung vòng hai' },
    { n: 1, kind: 'plan', markdown: '\nNội dung vòng một' },
  ],
}

const ERRORS: PlanSection<PlanErrorsOk> = {
  state: 'ok',
  rounds: [
    { n: 2, verdict: 'red', critical: 1, major: 0, minor: 2 },
    { n: 1, verdict: 'yellow', critical: 0, major: 1, minor: 0 },
    { n: 0, verdict: 'green', critical: 0, major: 0, minor: 0 },
  ],
}

/** Waits for the lazy highlighter to replace the plain fallback block, so no load lands after the test. */
async function highlighted() {
  await waitFor(() => expect(screen.queryByTestId('prism-fallback')).toBeNull())
}

describe('<ReviewRounds />', () => {
  it('UC-003/AC-20 lists the rounds in the order received, each collapsed, with "Vòng {n} · {kind}"', () => {
    render(<ReviewRounds section={REVIEW} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['Vòng 2 · code', 'Vòng 1 · plan'])
    for (const b of buttons) expect(b).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Nội dung vòng hai')).not.toBeInTheDocument()
  })

  it('opens the markdown of exactly the round pressed', async () => {
    render(<ReviewRounds section={REVIEW} />)
    const second = screen.getByRole('button', { name: 'Vòng 1 · plan' })
    fireEvent.click(second)
    expect(second).toHaveAttribute('aria-expanded', 'true')
    expect(second).toHaveAttribute('aria-controls', (await screen.findByText('Nội dung vòng một')).closest('[id]')?.id)
    expect(screen.queryByText('Nội dung vòng hai')).not.toBeInTheDocument()
    fireEvent.click(second)
    expect(screen.queryByText('Nội dung vòng một')).not.toBeInTheDocument()
  })

  it('shows the kind as written in the file', () => {
    render(<ReviewRounds section={{ state: 'ok', rounds: [{ n: 3, kind: 'Code · lớp 2', markdown: '' }] }} />)
    expect(screen.getByRole('button', { name: 'Vòng 3 · Code · lớp 2' })).toBeInTheDocument()
  })

  it('UC-003/AC-20 a change without review.md says there is no review round', () => {
    render(<ReviewRounds section={{ state: 'missing' }} />)
    expect(screen.getByText('Chưa có vòng review nào')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('UC-003/AC-23 a review.md without round headings is shown as written with the notice', async () => {
    render(<ReviewRounds section={{ state: 'unreadable', raw: 'Chỉ có chữ, không có heading vòng.' }} />)
    expect(screen.getByRole('region')).toHaveTextContent('Không đọc được tóm tắt review.md. Hiện nguyên file bên dưới.')
    expect(await screen.findByText('Chỉ có chữ, không có heading vòng.')).toBeInTheDocument()
  })
})

describe('rounds that repeat a number', () => {
  it('two rounds with one number both render with no duplicate-key warning', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const review: PlanSection<PlanReviewOk> = {
      state: 'ok',
      rounds: [{ n: 1, kind: 'plan', markdown: 'một' }, { n: 1, kind: 'plan', markdown: 'hai' }],
    }
    const { unmount } = render(<ReviewRounds section={review} />)
    expect(screen.getAllByRole('button')).toHaveLength(2)
    unmount()
    const errors: PlanSection<PlanErrorsOk> = {
      state: 'ok',
      rounds: [{ n: 2, verdict: 'red', critical: 0, major: 1, minor: 0 }, { n: 2, verdict: 'green', critical: 0, major: 0, minor: 0 }],
    }
    render(<ErrorRounds section={errors} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(error.mock.calls.filter(([message]) => /same key/.test(String(message)))).toEqual([])
    error.mockRestore()
  })
})

describe('a read error', () => {
  it('review: shows Không đọc được: {message} and no fallback notice', () => {
    render(<ReviewRounds section={{ state: 'error', message: 'path outside the plan folders' }} />)
    expect(screen.getByText('Không đọc được: path outside the plan folders')).toBeInTheDocument()
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    expect(screen.queryByText(/Hiện nguyên file bên dưới/)).not.toBeInTheDocument()
  })

  it('errors: shows Không đọc được: {message} and no fallback notice', () => {
    render(<ErrorRounds section={{ state: 'error', message: 'denied' }} />)
    expect(screen.getByText('Không đọc được: denied')).toBeInTheDocument()
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    expect(screen.queryByText(/Hiện nguyên file bên dưới/)).not.toBeInTheDocument()
  })
})

describe('<ErrorRounds />', () => {
  it('UC-003/AC-22 summarises each round: number, verdict and the open counts, newest first', () => {
    render(<ErrorRounds section={ERRORS} />)
    const rows = screen.getAllByRole('listitem').map((li) => li.textContent)
    expect(rows).toEqual([
      'Vòng 2 Đỏ Mở: 1 nghiêm trọng · 0 lớn · 2 nhỏ',
      'Vòng 1 Vàng Mở: 0 nghiêm trọng · 1 lớn · 0 nhỏ',
      'Vòng 0 Xanh Không còn lỗi mở',
    ])
  })

  it('UC-003/AC-21 counts only entries still open: the numbers are shown as received', () => {
    render(<ErrorRounds section={{ state: 'ok', rounds: [{ n: 1, verdict: 'yellow', critical: 0, major: 2, minor: 0 }] }} />)
    expect(screen.getByRole('listitem')).toHaveTextContent('Mở: 0 nghiêm trọng · 2 lớn · 0 nhỏ')
  })

  it('shows each verdict with its word and an icon', () => {
    render(<ErrorRounds section={ERRORS} />)
    for (const word of ['Đỏ', 'Vàng', 'Xanh']) expect(screen.getByText(word).querySelector('svg')).not.toBeNull()
  })

  it('has no expandable row: a test round is one line', () => {
    render(<ErrorRounds section={ERRORS} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('a critical count above zero is emphasised, a zero is not', () => {
    render(<ErrorRounds section={ERRORS} />)
    expect(screen.getByText('1 nghiêm trọng')).toHaveClass('text-danger-fg', 'font-medium')
    expect(screen.getAllByText('0 nghiêm trọng')[0]).not.toHaveClass('font-medium')
  })

  it.each(THEMES)('the emphasised critical count reaches 4.5:1 in %s', (theme) => {
    render(<ErrorRounds section={ERRORS} />)
    expect(ratio(colourOf(screen.getByText('1 nghiêm trọng'), 'text', theme), PANE[theme])).toBeGreaterThanOrEqual(4.5)
  })

  it('UC-003/AC-21 a change without errors.yaml has no test round', () => {
    render(<ErrorRounds section={{ state: 'missing' }} />)
    expect(screen.getByText('Chưa có vòng test nào')).toBeInTheDocument()
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
  })

  it('UC-003/AC-22 a malformed errors.yaml is shown as written inside a yaml fence', async () => {
    const raw = 'errors:\n  - round: x\n    verdict: purple'
    const { container } = render(<ErrorRounds section={{ state: 'unreadable', raw }} />)
    expect(screen.getByRole('region')).toHaveTextContent('Không đọc được tóm tắt errors.yaml. Hiện nguyên file bên dưới.')
    await highlighted()
    expect(container.querySelector('pre')?.textContent).toContain('round: x')
    expect(container.querySelector('pre')?.textContent).toContain('verdict: purple')
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
  })

  it('UC-003/AC-22 a blank errors.yaml shows the notice and no empty block', () => {
    const { container } = render(<ErrorRounds section={{ state: 'unreadable', raw: '' }} />)
    expect(screen.getByRole('region')).toBeInTheDocument()
    expect(container.querySelector('pre')).toBeNull()
  })
})

describe('<RawFallback />', () => {
  it('UC-003/AC-23 names the file, shows the icon and the text of a .md file as markdown', () => {
    const { container } = render(<RawFallback name="tasks.md" raw={'# Tasks\n\nKhông có dòng task nào.'} />)
    const region = screen.getByRole('region')
    expect(region).toHaveTextContent('Không đọc được tóm tắt tasks.md. Hiện nguyên file bên dưới.')
    expect(region.querySelector('svg')).not.toBeNull()
    expect(screen.getByRole('heading', { name: 'Tasks' })).toBeInTheDocument()
    expect(container.querySelector('pre')).toBeNull()
  })

  it('names its region by the notice text', () => {
    render(<RawFallback name="tasks.md" raw="x" />)
    const region = screen.getByRole('region', { name: /Không đọc được tóm tắt tasks\.md/ })
    expect(region).toHaveClass('border-warning-line', 'bg-warning-bg', 'text-warning-fg')
    expect(region.className).not.toMatch(/amber-|dark:/)
  })

  it('has no button and no field: nothing to press or type', () => {
    render(<RawFallback name="errors.yaml" raw="a: 1" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('keeps a yaml fence whole when the file text holds backticks', async () => {
    const raw = 'errors:\n  note: |\n    ```js\n    x\n    ```'
    const { container } = render(<RawFallback name="errors.yaml" raw={raw} />)
    await highlighted()
    expect(container.querySelector('pre')?.textContent).toContain('```js')
    const outer = [...container.querySelectorAll('pre')].filter((pre) => !pre.parentElement?.closest('pre'))
    expect(outer).toHaveLength(1)
    expect(within(container).queryByRole('heading')).toBeNull()
  })

  it.each(THEMES)('the notice reaches 4.5:1 in %s', (theme) => {
    render(<RawFallback name="tasks.md" raw="x" />)
    const region = screen.getByRole('region')
    expect(ratio(colourOf(region, 'text', theme), colourOf(region, 'bg', theme), PANE[theme])).toBeGreaterThanOrEqual(4.5)
  })
})

describe('on the new primitives', () => {
  it('each review round is a Disclosure heading of level 4 and its markdown starts at level 5', async () => {
    render(<ReviewRounds section={{ state: 'ok', rounds: [{ n: 2, kind: 'code', markdown: '# Tiêu đề vòng\n\nThân' }] }} />)
    expect(screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual(['Vòng 2 · code'])
    fireEvent.click(screen.getByRole('button', { name: 'Vòng 2 · code' }))
    expect(await screen.findByRole('heading', { level: 5, name: 'Tiêu đề vòng' })).toBeInTheDocument()
  })

  it('a review round sits in a bordered frame and a test round is one text-sm line', () => {
    const { container } = render(
      <>
        <ReviewRounds section={REVIEW} />
        <ErrorRounds section={ERRORS} />
      </>,
    )
    expect(container.querySelector('li.border')).toHaveClass('rounded-md', 'border-line')
    const row = screen.getByText('Vòng 2').closest('li') as HTMLElement
    expect(row).toHaveClass('flex', 'flex-wrap', 'items-center', 'gap-2', 'text-sm')
  })

  it('an empty review or test section is an inline empty state with an icon', () => {
    render(
      <>
        <ReviewRounds section={{ state: 'missing' }} />
        <ErrorRounds section={{ state: 'missing' }} />
      </>,
    )
    expect(screen.getByText('Chưa có vòng review nào').querySelector('svg')).not.toBeNull()
    expect(screen.getByText('Chưa có vòng test nào').querySelector('svg')).not.toBeNull()
  })

  it('a read error is an alert in the danger tokens, with no retry of its own', () => {
    render(<ReviewRounds section={{ state: 'error', message: 'too big' }} />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveClass('bg-danger-bg', 'text-danger-fg')
    expect(within(alert).getByText('Không đọc được: too big')).toBeInTheDocument()
    expect(within(alert).queryByRole('button')).toBeNull()
  })

  it('the file under a fallback notice starts at heading level 4', async () => {
    render(<RawFallback name="tasks.md" raw={'# Tasks\n\nNội dung'} />)
    expect(await screen.findByRole('heading', { level: 4, name: 'Tasks' })).toBeInTheDocument()
  })
})
