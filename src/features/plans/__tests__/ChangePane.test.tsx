// Change detail pane on plans_change (design brief S2) and the file view (S3).
// UC-003/AC-10 closed; AC-16 stale; AC-6 and AC-8 read only; AC-23 raw fallback.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'
import type { PlanChangeDetail, PlanChangeRow } from '@/types/spec'
import ChangePane, { SpecFileView } from '../ChangePane'
import { colourOf, PANE, ratio, THEMES } from './contrast'

const invokeMock = vi.mocked(invoke)
const PROJECT = '/abs/project'
const DIR = 'openspec/changes/demo'

const ROW: PlanChangeRow = {
  id: 'demo',
  dir: DIR,
  closed: false,
  archived_date: null,
  tasks_done: 3,
  tasks_total: 4,
  tasks_unreadable: false,
  approval: 'not_approved',
  latest_verdict: 'yellow',
  modified_at: 1,
}

const DETAIL: PlanChangeDetail = {
  id: 'demo',
  dir: DIR,
  closed: false,
  archived_date: null,
  approval: 'not_approved',
  tasks: {
    state: 'ok',
    done: 3,
    total: 4,
    waves: [
      {
        wave: 1,
        done: 3,
        total: 4,
        tasks: [
          { id: '1.1', title: 'Việc một', done: true },
          { id: '1.2', title: 'Việc hai', done: true },
          { id: '1.3', title: 'Việc ba', done: true },
          { id: '1.4', title: 'Việc bốn', done: false },
        ],
      },
    ],
  },
  review: { state: 'ok', rounds: [{ n: 1, kind: 'plan', markdown: 'Nội dung review' }] },
  errors: { state: 'ok', rounds: [{ n: 1, verdict: 'yellow', critical: 0, major: 1, minor: 0 }] },
  docs: [
    { label: 'plan.vi.md', path: `${DIR}/plan.vi.md` },
    { label: 'proposal.md', path: `${DIR}/proposal.md` },
  ],
}

function wire(detail: PlanChangeDetail | Error | 'pending') {
  invokeMock.mockImplementation((cmd: string, args?: unknown) => {
    const a = (args ?? {}) as { relPath?: string }
    if (cmd === 'plans_change') {
      if (detail === 'pending') return new Promise(() => {})
      return detail instanceof Error ? Promise.reject(detail) : Promise.resolve(detail)
    }
    if (cmd === 'plans_read') return Promise.resolve(`Văn bản ${a.relPath}`)
    return Promise.resolve([])
  })
}

function renderPane(row: PlanChangeRow = ROW) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const out = render(
    <QueryClientProvider client={qc}>
      <ChangePane project={PROJECT} change={row} />
    </QueryClientProvider>,
  )
  return { qc, ...out }
}

/** Waits until the detail has been read: the busy flag of the pane is gone. */
async function loaded(container: HTMLElement) {
  await waitFor(() => expect(container.firstElementChild).not.toHaveAttribute('aria-busy', 'true'))
}

describe('<ChangePane />', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('reads plans_change for the project and dir under [plans, project, change, dir]', async () => {
    wire(DETAIL)
    const { qc, container } = renderPane()
    await loaded(container)
    expect(invokeMock).toHaveBeenCalledWith('plans_change', { project: PROJECT, dir: DIR })
    expect(qc.getQueryData(['plans', PROJECT, 'change', DIR])).toEqual(DETAIL)
  })

  it('shows the id, then Duyệt plan, Tiến độ, Review, Test and Tài liệu in that order', async () => {
    wire(DETAIL)
    const { container } = renderPane()
    await loaded(container)
    const headings = screen.getAllByRole('heading', { level: 2 }).concat(screen.getAllByRole('heading', { level: 3 })).map((h) => [h.tagName, h.textContent])
    expect(headings).toEqual([
      ['H2', 'demo'],
      ['H3', 'Duyệt plan'],
      ['H3', 'Tiến độ'],
      ['H3', 'Review'],
      ['H3', 'Test'],
      ['H3', 'Tài liệu'],
    ])
  })

  it('names each section by its heading', async () => {
    wire(DETAIL)
    const { container } = renderPane()
    await loaded(container)
    for (const name of ['Duyệt plan', 'Tiến độ', 'Review', 'Test', 'Tài liệu']) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument()
    }
  })

  it('loading: the header of the row is real and every section is a headed skeleton', () => {
    wire('pending')
    const { container } = renderPane()
    expect(screen.getByRole('heading', { name: 'demo' })).toBeInTheDocument()
    expect(screen.getByText('Duyệt trong Claude Code')).toBeInTheDocument()
    expect(container.querySelectorAll('[data-skeleton-row]')).toHaveLength(10)
    expect(container.firstElementChild).toHaveAttribute('aria-busy', 'true')
    for (const note of screen.getAllByText('Đang tải…')) expect(note).toHaveClass('sr-only')
    expect(screen.getByRole('heading', { name: 'Tiến độ' })).toBeInTheDocument()
    expect(screen.queryByText(/task xong/)).not.toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('error: shows "Không đọc được: {message}" with "Thử lại", which reads the change again', async () => {
    wire(new Error('denied'))
    renderPane()
    expect(await screen.findByText('Không đọc được: denied')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'demo' })).toBeInTheDocument()
    wire(DETAIL)
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }))
    expect(await screen.findByText('3/4 task xong')).toBeInTheDocument()
    expect(screen.queryByText(/Không đọc được: denied/)).not.toBeInTheDocument()
    expect(invokeMock.mock.calls.filter(([c]) => c === 'plans_change')).toHaveLength(2)
  })

  it('a failed refetch replaces the old detail with the error and Thử lại', async () => {
    wire(DETAIL)
    const { qc, container } = renderPane()
    await loaded(container)
    expect(screen.getByText('3/4 task xong')).toBeInTheDocument()
    wire(new Error('gone'))
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['plans', PROJECT] })
    })
    expect(await screen.findByText('Không đọc được: gone')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeInTheDocument()
    expect(screen.queryByText('3/4 task xong')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Tiến độ' })).not.toBeInTheDocument()
  })

  it('a failed refetch shows the tree row header, not the previous detail', async () => {
    wire({ ...DETAIL, approval: 'approved' })
    const { qc, container } = renderPane({ ...ROW, approval: 'stale' })
    await loaded(container)
    expect(screen.getAllByText('Plan đã duyệt')).not.toHaveLength(0)
    wire(new Error('gone'))
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['plans', PROJECT] })
    })
    expect(await screen.findByText('Không đọc được: gone')).toBeInTheDocument()
    const header = container.querySelector('header') as HTMLElement
    expect(within(header).getByText('Cần duyệt lại')).toBeInTheDocument()
    expect(within(header).queryByText('Plan đã duyệt')).not.toBeInTheDocument()
  })

  it('a detail with an unknown approval renders the other sections', async () => {
    wire({ ...DETAIL, approval: 'weird' as unknown as PlanChangeDetail['approval'] })
    const { container } = renderPane({ ...ROW, approval: 'weird' as unknown as PlanChangeRow['approval'] })
    await loaded(container)
    const section = screen.getByRole('region', { name: 'Duyệt plan' })
    expect(section.querySelector('svg')).toBeNull()
    expect(section.querySelector('p')).toBeNull()
    expect(screen.getByText('3/4 task xong')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Tài liệu' })).toBeInTheDocument()
  })

  describe('Duyệt plan', () => {
    it('UC-003/AC-17 a change without a stamp reads "Plan chưa duyệt" and points to Claude Code', async () => {
      wire(DETAIL)
      const { container } = renderPane()
      await loaded(container)
      const section = screen.getByRole('region', { name: 'Duyệt plan' })
      expect(within(section).getByText('Plan chưa duyệt')).toBeInTheDocument()
      expect(within(section).getByText('Chưa có dấu duyệt trong approval.md. Duyệt trong Claude Code.')).toBeInTheDocument()
      expect(screen.getByText('Duyệt trong Claude Code')).toBeInTheDocument()
    })

    it('UC-003/AC-15 a matching stamp reads "Plan đã duyệt"', async () => {
      wire({ ...DETAIL, approval: 'approved' })
      const { container } = renderPane({ ...ROW, approval: 'approved' })
      await loaded(container)
      const section = screen.getByRole('region', { name: 'Duyệt plan' })
      expect(within(section).getByText('Plan đã duyệt')).toBeInTheDocument()
      expect(within(section).getByText('Dấu duyệt khớp với plan hiện tại.')).toBeInTheDocument()
    })

    it('UC-003/AC-16 a stamp that no longer matches reads "Cần duyệt lại" in a danger Banner region', async () => {
      wire({ ...DETAIL, approval: 'stale' })
      const { container } = renderPane({ ...ROW, approval: 'stale' })
      await loaded(container)
      const section = screen.getByRole('region', { name: 'Duyệt plan' })
      expect(within(section).getByText('Cần duyệt lại')).toBeInTheDocument()
      const warning = within(section).getByRole('region')
      expect(warning).toHaveTextContent('Plan đã đổi sau lần duyệt trước. Duyệt lại trong Claude Code.')
      expect(warning).toHaveClass('border-danger-line', 'bg-danger-bg', 'text-danger-fg')
      expect(warning.className).not.toMatch(/rose-|dark:/)
      expect(warning).toHaveAttribute('aria-labelledby')
      expect(warning).not.toHaveAttribute('role', 'alert')
      expect(warning.querySelector('svg')).not.toBeNull()
    })

    it.each(THEMES)('the stale warning reaches 4.5:1 in %s', async (theme) => {
      wire({ ...DETAIL, approval: 'stale' })
      const { container } = renderPane({ ...ROW, approval: 'stale' })
      await loaded(container)
      const section = screen.getByRole('region', { name: 'Duyệt plan' })
      const warning = within(section).getByRole('region')
      expect(ratio(colourOf(warning, 'text', theme), colourOf(warning, 'bg', theme), PANE[theme])).toBeGreaterThanOrEqual(4.5)
    })

    it('the explanation of an approved or unapproved plan is muted text on the pane', async () => {
      wire(DETAIL)
      const { container } = renderPane()
      await loaded(container)
      const line = screen.getByText('Chưa có dấu duyệt trong approval.md. Duyệt trong Claude Code.')
      for (const theme of THEMES) expect(ratio(colourOf(line, 'text', theme), PANE[theme])).toBeGreaterThanOrEqual(4.5)
    })
  })

  it('shows where the change sits: the project folder, Thay đổi and the id; a closed one sits under Đã đóng', async () => {
    wire(DETAIL)
    const open = renderPane()
    await loaded(open.container)
    const nav = screen.getByRole('navigation', { name: 'Vị trí' })
    expect(within(nav).getAllByRole('listitem').map((i) => i.textContent)).toEqual(['project', 'Thay đổi', 'demo'])
    open.unmount()
    wire({ ...DETAIL, closed: true, archived_date: '2026-11-01' })
    const closed = renderPane({ ...ROW, closed: true, archived_date: '2026-11-01' })
    await loaded(closed.container)
    expect(within(screen.getByRole('navigation', { name: 'Vị trí' })).getAllByRole('listitem').map((i) => i.textContent)).toEqual(['project', 'Đã đóng', 'demo'])
  })

  it('the h2 is the id in text-md, and the sections are h3 text-sm', async () => {
    wire(DETAIL)
    const { container } = renderPane()
    await loaded(container)
    expect(screen.getByRole('heading', { level: 2, name: 'demo' })).toHaveClass('text-md', 'font-semibold')
    expect(screen.getByRole('heading', { level: 3, name: 'Tiến độ' })).toHaveClass('text-sm', 'font-semibold')
  })

  it('the unreadable detail is an alert ErrorState; Thử lại is its button', async () => {
    wire(new Error('denied'))
    renderPane()
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Không đọc được: denied')).toBeInTheDocument()
    expect(within(alert).getByRole('button', { name: 'Thử lại' })).toBeInTheDocument()
  })

  describe('closed and open', () => {
    const CLOSED = { closed: true, archived_date: '2026-11-01' }

    it('UC-003/AC-10 a change under the archive shows the closed mark and "Đã đóng ngày … · chỉ đọc"', async () => {
      wire({ ...DETAIL, ...CLOSED })
      const { container } = renderPane({ ...ROW, ...CLOSED })
      await loaded(container)
      expect(within(container.querySelector('header') as HTMLElement).getByText('Đã đóng')).toBeInTheDocument()
      expect(screen.getByText('Đã đóng ngày 2026-11-01 · chỉ đọc')).toBeInTheDocument()
      expect(screen.queryByText('Duyệt trong Claude Code')).not.toBeInTheDocument()
    })

    it('a closed change drops the invitation from the approval line but keeps the state', async () => {
      wire({ ...DETAIL, ...CLOSED, approval: 'stale' })
      const { container } = renderPane({ ...ROW, ...CLOSED, approval: 'stale' })
      await loaded(container)
      const section = screen.getByRole('region', { name: 'Duyệt plan' })
      expect(within(section).getByText('Cần duyệt lại')).toBeInTheDocument()
      expect(within(section).getByRole('region')).toHaveTextContent(/^Plan đã đổi sau lần duyệt trước\.$/)
    })

    it('a closed change without a stamp keeps only the first sentence', async () => {
      wire({ ...DETAIL, ...CLOSED })
      const { container } = renderPane({ ...ROW, ...CLOSED })
      await loaded(container)
      const section = screen.getByRole('region', { name: 'Duyệt plan' })
      expect(within(section).getByText('Chưa có dấu duyệt trong approval.md.')).toBeInTheDocument()
    })

    it('a closed change without a date still reads as closed', async () => {
      wire({ ...DETAIL, closed: true })
      const { container } = renderPane({ ...ROW, closed: true })
      await loaded(container)
      expect(screen.getByText('Đã đóng · chỉ đọc')).toBeInTheDocument()
    })

    it('UC-003/AC-10 a finished change outside the archive stays open: no closed mark', async () => {
      const finished = { ...DETAIL, tasks: { ...(DETAIL.tasks as { state: 'ok' }), done: 4, total: 4 } } as PlanChangeDetail
      wire(finished)
      const { container } = renderPane({ ...ROW, tasks_done: 4 })
      await loaded(container)
      expect(screen.queryByText('Đã đóng')).not.toBeInTheDocument()
      expect(screen.getByText('Duyệt trong Claude Code')).toBeInTheDocument()
    })
  })

  it('shows the progress, the review round, the test round and the documents of the detail', async () => {
    wire(DETAIL)
    renderPane()
    expect(await screen.findByText('3/4 task xong')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Vòng 1 · plan' })).toBeInTheDocument()
    expect(screen.getByText('Vàng').closest('li')).toHaveTextContent('Mở: 0 nghiêm trọng · 1 lớn · 0 nhỏ')
    expect(screen.getByRole('button', { name: 'plan.vi.md' })).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByText(`Văn bản ${DIR}/plan.vi.md`)).toBeInTheDocument()
  })

  it('partial: a section without its file says so and the others still show', async () => {
    wire({
      ...DETAIL,
      tasks: { state: 'missing' },
      review: { state: 'missing' },
      errors: { state: 'missing' },
      docs: [],
    })
    renderPane()
    expect(await screen.findByText('Chưa có tasks.md')).toBeInTheDocument()
    expect(screen.getByText('Chưa có vòng review nào')).toBeInTheDocument()
    expect(screen.getByText('Chưa có vòng test nào')).toBeInTheDocument()
    expect(screen.getByText('Thay đổi này chưa có tài liệu nào')).toBeInTheDocument()
    expect(screen.getAllByText('Plan chưa duyệt')).toHaveLength(2)
  })

  it('UC-003/AC-23 a tasks.md without task lines is shown as written, the other sections stay', async () => {
    wire({ ...DETAIL, tasks: { state: 'unreadable', raw: 'Không có dòng nào là task.' } })
    const { container } = renderPane()
    await loaded(container)
    const progress = screen.getByRole('region', { name: 'Tiến độ' })
    expect(within(progress).getByRole('region')).toHaveTextContent('Không đọc được tóm tắt tasks.md. Hiện nguyên file bên dưới.')
    expect(within(progress).getByText('Không có dòng nào là task.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Vòng 1 · plan' })).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('a read error shows Không đọc được: {message} without the fallback notice', async () => {
    wire({ ...DETAIL, tasks: { state: 'error', message: 'file larger than 2 MiB' } })
    const { container } = renderPane()
    await loaded(container)
    const progress = screen.getByRole('region', { name: 'Tiến độ' })
    expect(within(progress).getByText('Không đọc được: file larger than 2 MiB')).toBeInTheDocument()
    expect(within(progress).queryByRole('region')).not.toBeInTheDocument()
    expect(screen.queryByText(/Hiện nguyên file bên dưới/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Vòng 1 · plan' })).toBeInTheDocument()
  })

  it('UC-003/AC-23 a review.md and an errors.yaml in the wrong shape are shown as written', async () => {
    wire({
      ...DETAIL,
      review: { state: 'unreadable', raw: 'review không có vòng' },
      errors: { state: 'unreadable', raw: 'errors: oops' },
    })
    const { container } = renderPane()
    await loaded(container)
    const review = screen.getByRole('region', { name: 'Review' })
    expect(within(review).getByText('review không có vòng')).toBeInTheDocument()
    const test = screen.getByRole('region', { name: 'Test' })
    expect(within(test).getByRole('region')).toHaveTextContent('Không đọc được tóm tắt errors.yaml')
    await waitFor(() => expect(screen.queryByTestId('prism-fallback')).toBeNull())
  })

  it('UC-003/E1 a document that cannot be read leaves the rest of the detail shown', async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === 'plans_change' ? Promise.resolve(DETAIL) : cmd === 'plans_read' ? Promise.reject(new Error('gone')) : Promise.resolve([]),
    )
    renderPane()
    expect(await screen.findByText('Không đọc được: gone')).toBeInTheDocument()
    expect(screen.getByText('3/4 task xong')).toBeInTheDocument()
    expect(screen.getAllByText(/Không đọc được/)).toHaveLength(1)
  })

  it.each([
    ['an open change', false],
    ['a closed change', true],
  ])('UC-003/AC-6 and AC-8 %s has no approve, stamp, edit or comment control and no field', async (_name, closed) => {
    wire({ ...DETAIL, closed, archived_date: closed ? '2026-11-01' : null })
    const { container } = renderPane({ ...ROW, closed })
    await loaded(container)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /gửi|bình luận|comment|^duyệt|approve|stamp|sửa|edit|thêm|add|tạo/i }),
    ).not.toBeInTheDocument()
    const commands = new Set(invokeMock.mock.calls.map(([c]) => c))
    expect([...commands].every((c) => c === 'plans_change' || c === 'plans_read')).toBe(true)
  })

  it('wraps a long id instead of cutting it', () => {
    wire('pending')
    renderPane({ ...ROW, id: 'a-very-long-change-name-that-keeps-going' })
    expect(screen.getByRole('heading', { name: 'a-very-long-change-name-that-keeps-going' })).toHaveClass(
      'font-mono',
      '[overflow-wrap:anywhere]',
    )
  })
})

describe('<SpecFileView />', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  function renderFile(path = 'openspec/specs/auth/spec.md', title = 'auth') {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
      <QueryClientProvider client={qc}>
        <SpecFileView project={PROJECT} path={path} title={title} />
      </QueryClientProvider>,
    )
  }

  it('reads through plansRead and shows the title, the text and no status badge', async () => {
    wire(DETAIL)
    const { container } = renderFile()
    expect(screen.getByRole('heading', { level: 2, name: 'auth' })).toBeInTheDocument()
    expect(await screen.findByText('Văn bản openspec/specs/auth/spec.md')).toBeInTheDocument()
    expect(invokeMock).toHaveBeenCalledWith('plans_read', { project: PROJECT, relPath: 'openspec/specs/auth/spec.md' })
    expect(container.querySelector('header span.inline-flex')).toBeNull()
    expect(within(screen.getByRole('navigation', { name: 'Vị trí' })).getAllByRole('listitem').map((i) => i.textContent)).toEqual(['project', 'Specs', 'auth'])
  })

  it('the document of the file sits under the h2: its own h1 renders as an h3', async () => {
    invokeMock.mockImplementation(() => Promise.resolve('# Tiêu đề của spec'))
    renderFile()
    expect(await screen.findByRole('heading', { level: 3, name: 'Tiêu đề của spec' })).toBeInTheDocument()
  })

  it('a file that cannot be read shows its error', async () => {
    invokeMock.mockImplementation(() => Promise.reject(new Error('gone')))
    renderFile('openspec/_debt.md', '_debt.md')
    expect(await screen.findByText('Không đọc được: gone')).toBeInTheDocument()
  })
})
