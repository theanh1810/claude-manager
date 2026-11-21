// Task progress of a change (design brief S2 "Tiến độ").
// UC-003/AC-18 counts ticked and unticked task lines; UC-003/AC-19 groups them by wave.

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import type { PlanTasksOk } from '@/types/spec'
import TaskProgress from '../TaskProgress'
import { colourOf, PANE, ratio, THEMES } from './contrast'

const TASKS: PlanTasksOk = {
  done: 3,
  total: 6,
  waves: [
    {
      wave: 1,
      done: 2,
      total: 2,
      tasks: [
        { id: '1.1', title: 'Tạo reader', done: true },
        { id: '1.2', title: 'Đọc tasks.md', done: true },
      ],
    },
    {
      wave: 2,
      done: 1,
      total: 3,
      tasks: [
        { id: '2.1', title: 'Đọc errors.yaml', done: true },
        { id: '2.2', title: 'Vẽ cây', done: false },
        { id: '2.3', title: 'Vẽ chi tiết', done: false },
      ],
    },
    { wave: null, done: 0, total: 1, tasks: [{ id: '9.1', title: 'Việc lẻ', done: false }] },
  ],
}

describe('<TaskProgress />', () => {
  it('UC-003/AC-18 shows the total line and a progressbar with the counts', () => {
    render(<TaskProgress tasks={TASKS} />)
    expect(screen.getByText('3/6 task xong')).toBeInTheDocument()
    const bar = screen.getByRole('progressbar', { name: 'Tiến độ task' })
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '6')
    expect(bar).toHaveAttribute('aria-valuenow', '3')
    expect((bar.firstElementChild as HTMLElement).style.transform).toBe('scaleX(0.5)')
    expect(screen.getByText('3/6 task xong')).toHaveClass('text-sm', 'tabular-nums')
  })

  it('the total bar is the ProgressBar primitive: a success fill on a surface-3 track, with no animation', () => {
    render(<TaskProgress tasks={TASKS} />)
    const bar = screen.getByRole('progressbar', { name: 'Tiến độ task' })
    expect(bar).toHaveClass('bg-surface-3', 'h-2')
    expect(bar.firstElementChild).toHaveClass('bg-progress')
    expect(bar.firstElementChild?.className).not.toMatch(/transition/)
  })

  it('two tasks with one id both render with no duplicate-key warning', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const twice: PlanTasksOk = {
      done: 0,
      total: 2,
      waves: [{ wave: 1, done: 0, total: 2, tasks: [{ id: '1.1', title: 'Lần một', done: false }, { id: '1.1', title: 'Lần hai', done: false }] }],
    }
    render(<TaskProgress tasks={twice} />)
    expect(screen.getByText('Lần một')).toBeInTheDocument()
    expect(screen.getByText('Lần hai')).toBeInTheDocument()
    expect(error.mock.calls.filter(([message]) => /same key/.test(String(message)))).toEqual([])
    error.mockRestore()
  })

  it('UC-003/AC-18 a change with every task ticked fills the bar', () => {
    render(<TaskProgress tasks={{ done: 2, total: 2, waves: [TASKS.waves[0]] }} />)
    expect(screen.getByText('2/2 task xong')).toBeInTheDocument()
    expect((screen.getByRole('progressbar').firstElementChild as HTMLElement).style.transform).toBe('scaleX(1)')
  })

  it('UC-003/AC-19 gives one disclosure per wave, in the order received, the ungrouped one last', () => {
    render(<TaskProgress tasks={TASKS} />)
    const heads = screen.getAllByRole('heading', { level: 4 })
    expect(heads.map((h) => h.textContent)).toEqual(['Wave 12/2', 'Wave 21/3', 'Chưa nhóm wave0/1'])
    for (const [head, count] of [[heads[0], '2/2'], [heads[1], '1/3'], [heads[2], '0/1']] as const) {
      expect(within(head).getByText(count)).toHaveClass('tabular-nums')
    }
  })

  it('UC-003/AC-19 a finished wave starts collapsed and a wave with work left starts open', () => {
    render(<TaskProgress tasks={TASKS} />)
    const finished = screen.getByRole('button', { name: /Wave 1/ })
    const unfinished = screen.getByRole('button', { name: /Wave 2/ })
    const ungrouped = screen.getByRole('button', { name: /Chưa nhóm wave/ })
    expect(finished).toHaveAttribute('aria-expanded', 'false')
    expect(unfinished).toHaveAttribute('aria-expanded', 'true')
    expect(ungrouped).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByText('Tạo reader')).not.toBeInTheDocument()
    expect(screen.getByText('Vẽ cây')).toBeInTheDocument()
    expect(screen.getByText('Việc lẻ')).toBeInTheDocument()
  })

  it('a wave opens and closes from its button and names the list it controls', () => {
    render(<TaskProgress tasks={TASKS} />)
    const finished = screen.getByRole('button', { name: /Wave 1/ })
    fireEvent.click(finished)
    expect(finished).toHaveAttribute('aria-expanded', 'true')
    const panel = screen.getByText('Tạo reader').closest('div[id]') as HTMLElement
    expect(finished).toHaveAttribute('aria-controls', panel.id)
    fireEvent.click(finished)
    expect(screen.queryByText('Tạo reader')).not.toBeInTheDocument()
  })

  it('shows each task id and title, and marks done with sr-only words beside the box', () => {
    render(<TaskProgress tasks={TASKS} />)
    const done = screen.getByText('Đọc errors.yaml').closest('li') as HTMLElement
    const open = screen.getByText('Vẽ cây').closest('li') as HTMLElement
    expect(within(done).getByText('2.1')).toHaveClass('font-mono', 'text-xs', 'text-ink-muted')
    expect(within(done).getByText('Đã xong')).toHaveClass('sr-only')
    expect(within(open).getByText('2.2')).toBeInTheDocument()
    expect(within(open).getByText('Chưa xong')).toHaveClass('sr-only')
    expect(done.querySelector('svg')).not.toBeNull()
    expect(open.querySelector('svg')).toBeNull()
  })

  it('a done task reads muted and a task title wraps instead of being cut', () => {
    render(<TaskProgress tasks={TASKS} />)
    const done = screen.getByText('Đọc errors.yaml')
    expect(done).toHaveClass('text-sm', 'text-ink-muted')
    expect(done).not.toHaveClass('truncate')
    expect(screen.getByText('Vẽ cây')).not.toHaveClass('text-ink-muted')
  })

  it('UC-003/AC-6 has no tick control: the task boxes are not interactive', () => {
    render(<TaskProgress tasks={TASKS} />)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(3)
  })

  it.each(THEMES)('the muted done title and the tick reach their contrast in %s', (theme) => {
    render(<TaskProgress tasks={TASKS} />)
    const title = screen.getByText('Đọc errors.yaml')
    expect(ratio(colourOf(title, 'text', theme), PANE[theme])).toBeGreaterThanOrEqual(4.5)
    const box = screen.getByText('Đọc errors.yaml').closest('li')?.querySelector('span[class*="border"]') as Element
    expect(box).toHaveClass('size-4', 'border-success-solid', 'bg-success-solid', 'text-accent-on')
    expect(ratio(colourOf(box, 'text', theme), colourOf(box, 'bg', theme))).toBeGreaterThanOrEqual(4.5)
    const open = screen.getByText('Vẽ cây').closest('li')?.querySelector('span[class*="border"]') as Element
    expect(open).toHaveClass('border-line-control')
  })

  it.each(THEMES)('the bar fill stands out from its track by 3:1 in %s', (theme) => {
    render(<TaskProgress tasks={TASKS} />)
    const track = screen.getByRole('progressbar', { name: 'Tiến độ task' })
    const fill = track.firstElementChild as Element
    expect(ratio(colourOf(fill, 'bg', theme), colourOf(track, 'bg', theme))).toBeGreaterThanOrEqual(3)
  })
})
