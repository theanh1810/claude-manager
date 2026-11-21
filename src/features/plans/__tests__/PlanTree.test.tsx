// Plans tree on plans_tree (design brief S1, S5).
// UC-003/AC-1, AC-2, AC-3, AC-10, AC-26, AC-27, AC-28.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'
import type { AdhocRow, PlanChangeRow, PlansTree } from '@/types/spec'
import PlanTree, { type PlanSelection } from '../PlanTree'
import { api } from '@/lib/ipc'
import { colourOf, PANE, ratio, THEMES } from './contrast'

const invokeMock = vi.mocked(invoke)

const PROJECTS = [
  { id: 'p1', name: 'alpha', path: '/abs/a', color: null, added_at: '', last_opened_at: null },
  { id: 'p2', name: 'beta', path: '/abs/b', color: null, added_at: '', last_opened_at: null },
]

function row(id: string, over: Partial<PlanChangeRow> = {}): PlanChangeRow {
  return {
    id,
    dir: `openspec/changes/${id}`,
    closed: false,
    archived_date: null,
    tasks_done: 3,
    tasks_total: 7,
    tasks_unreadable: false,
    approval: 'not_approved',
    latest_verdict: null,
    modified_at: 1,
    ...over,
  }
}

function closedRow(id: string, date: string, over: Partial<PlanChangeRow> = {}): PlanChangeRow {
  return row(id, { dir: `openspec/changes/archive/${date}-${id}`, closed: true, archived_date: date, approval: 'approved', ...over })
}

function run(slug: string, date: string | null = '2026-03-01', over: Partial<AdhocRow> = {}): AdhocRow {
  return { slug, date, dir: `docs/changes/adhoc/${date ? `${date}-` : ''}${slug}`, has_record: true, has_independent: false, ...over }
}

function tree(over: Partial<PlansTree> = {}): PlansTree {
  return { openspec: 'present', changes: [], specs: [], debt: null, glossary: null, adhoc: [], ...over }
}

const FULL: PlansTree = tree({
  changes: [
    row('first', { latest_verdict: 'red' }),
    row('second', { approval: 'approved', tasks_done: 7, tasks_total: 7, latest_verdict: 'green' }),
    row('stale-one', { approval: 'stale' }),
    row('no-tasks', { tasks_done: null, tasks_total: null }),
    closedRow('old-b', '2026-10-02', { latest_verdict: 'yellow' }),
    closedRow('old-a', '2026-10-01', { tasks_done: 2, tasks_total: 2 }),
  ],
  specs: [
    { capability: 'alpha-cap', path: 'openspec/specs/alpha-cap/spec.md' },
    { capability: 'beta-cap', path: 'openspec/specs/beta-cap/spec.md' },
  ],
  debt: 'openspec/_debt.md',
  glossary: 'openspec/glossary.md',
})

function wire(trees: Record<string, PlansTree | Error>) {
  invokeMock.mockImplementation((cmd: string, args?: unknown) => {
    const a = (args ?? {}) as { project?: string }
    if (cmd === 'list_projects') return Promise.resolve(PROJECTS)
    if (cmd === 'plans_tree') {
      const t = trees[a.project ?? '']
      return t instanceof Error ? Promise.reject(t) : Promise.resolve(t)
    }
    return Promise.resolve([])
  })
}

function renderTree(project: string | null, selected: PlanSelection | null = null, onSelect: (s: PlanSelection) => void = () => {}, extra?: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const out = render(
    <QueryClientProvider client={qc}>
      <PlanTree project={project} selected={selected} onSelect={onSelect} />
      {extra}
    </QueryClientProvider>,
  )
  return { qc, ...out }
}

const names = (items: HTMLElement[]) => items.map((i) => i.textContent)

describe('<PlanTree />', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  describe('groups and rows', () => {
    it('shows Thay đổi open by default with its count, and Specs collapsed', async () => {
      wire({ '/abs/a': FULL })
      renderTree('/abs/a')
      const changes = await screen.findByRole('button', { name: /^Thay đổi/ })
      expect(changes).toHaveAttribute('aria-expanded', 'true')
      expect(changes).toHaveTextContent('Thay đổi(6)')
      const specs = screen.getByRole('button', { name: /^Specs/ })
      expect(specs).toHaveAttribute('aria-expanded', 'false')
      expect(specs).toHaveTextContent('Specs(2)')
      expect(screen.queryByText('alpha-cap')).not.toBeInTheDocument()
    })

    it('UC-003/AC-1 lists open changes in the order received, then the collapsed Đã đóng group', async () => {
      wire({ '/abs/a': FULL })
      renderTree('/abs/a')
      await screen.findByText('first')
      const ids = ['first', 'second', 'stale-one', 'no-tasks'].map((id) => screen.getByText(id))
      for (let i = 1; i < ids.length; i++) {
        expect(ids[i - 1].compareDocumentPosition(ids[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      }
      const closed = screen.getByRole('button', { name: /^Đã đóng/ })
      expect(closed).toHaveAttribute('aria-expanded', 'false')
      expect(ids[3].compareDocumentPosition(closed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(screen.queryByText('old-a')).not.toBeInTheDocument()
    })

    it('UC-003/AC-10 closed changes sit under Đã đóng in the order received, and a finished open change stays in the open list', async () => {
      wire({ '/abs/a': FULL })
      renderTree('/abs/a')
      await screen.findByText('first')
      expect(screen.getByText('second')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: /^Đã đóng/ }))
      const olds = await screen.findAllByText(/^old-/)
      expect(names(olds)).toEqual(['old-b', 'old-a'])
      expect(screen.getByRole('button', { name: /^Đã đóng/ })).toHaveTextContent('Đã đóng(2)')
    })

    it('an open row shows the id, the task count, the approval badge and the latest verdict', async () => {
      wire({ '/abs/a': FULL })
      renderTree('/abs/a')
      const first = (await screen.findByText('first')).closest('button') as HTMLElement
      expect(within(first).getByText('3/7 task')).toBeInTheDocument()
      expect(within(first).getByText('Plan chưa duyệt')).toBeInTheDocument()
      expect(within(first).getByRole('img', { name: 'Test gần nhất: đỏ' })).toBeInTheDocument()
      expect(within(first).getByText('first')).toHaveClass('font-mono', 'truncate')
      expect(within(first).getByText('first')).toHaveAttribute('title', 'first')
    })

    it('UC-003/AC-15, AC-16 the three approval labels reach the rows', async () => {
      wire({ '/abs/a': FULL })
      renderTree('/abs/a')
      const rowOf = async (id: string) => (await screen.findByText(id)).closest('button') as HTMLElement
      expect(within(await rowOf('second')).getByText('Plan đã duyệt')).toBeInTheDocument()
      expect(within(await rowOf('stale-one')).getByText('Cần duyệt lại')).toBeInTheDocument()
    })

    it('a row without a verdict shows no verdict mark', async () => {
      wire({ '/abs/a': FULL })
      renderTree('/abs/a')
      const stale = (await screen.findByText('stale-one')).closest('button') as HTMLElement
      expect(within(stale).queryByRole('img')).not.toBeInTheDocument()
    })

    it('a change without tasks.md reads "chưa có task"', async () => {
      wire({ '/abs/a': FULL })
      renderTree('/abs/a')
      const r = (await screen.findByText('no-tasks')).closest('button') as HTMLElement
      expect(within(r).getByText('chưa có task')).toBeInTheDocument()
      expect(within(r).queryByText(/\d+\/\d+ task/)).not.toBeInTheDocument()
    })

    it('a row whose tasks.md is unreadable shows no task count', async () => {
      wire({ '/abs/a': tree({ changes: [row('bad-tasks', { tasks_done: null, tasks_total: null, tasks_unreadable: true })] }) })
      renderTree('/abs/a')
      const r = (await screen.findByText('bad-tasks')).closest('button') as HTMLElement
      expect(within(r).queryByText(/\d+\/\d+ task/)).not.toBeInTheDocument()
      expect(within(r).queryByText('chưa có task')).not.toBeInTheDocument()
      expect(within(r).getByText('Plan chưa duyệt')).toBeInTheDocument()
    })

    it('a closed row shows its date and task count, and no approval badge', async () => {
      wire({ '/abs/a': FULL })
      renderTree('/abs/a')
      fireEvent.click(await screen.findByRole('button', { name: /^Đã đóng/ }))
      const r = (await screen.findByText('old-a')).closest('button') as HTMLElement
      expect(within(r).getByText('2026-10-01')).toBeInTheDocument()
      expect(within(r).getByText('2/2 task')).toBeInTheDocument()
      expect(within(r).queryByText(/^Plan /)).not.toBeInTheDocument()
      expect(within(screen.getByText('old-b').closest('button') as HTMLElement).getByRole('img', { name: 'Test gần nhất: vàng' })).toBeInTheDocument()
    })

    it('Specs lists the capabilities, then _debt.md and glossary.md after a divider', async () => {
      wire({ '/abs/a': FULL })
      renderTree('/abs/a')
      fireEvent.click(await screen.findByRole('button', { name: /^Specs/ }))
      const files = ['alpha-cap', 'beta-cap', '_debt.md', 'glossary.md'].map((t) => screen.getByRole('button', { name: t }))
      for (let i = 1; i < files.length; i++) {
        expect(files[i - 1].compareDocumentPosition(files[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      }
      expect(files[2].closest('li')).toHaveClass('border-t', 'border-line')
    })

    it('Specs shows no _debt.md or glossary.md row when the files do not exist', async () => {
      wire({ '/abs/a': { ...FULL, debt: null, glossary: null } })
      renderTree('/abs/a')
      fireEvent.click(await screen.findByRole('button', { name: /^Specs/ }))
      expect(screen.queryByRole('button', { name: '_debt.md' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'glossary.md' })).not.toBeInTheDocument()
    })
  })

  describe('selection', () => {
    it('pressing a change row selects it with its row; pressing a spec row selects the file', async () => {
      wire({ '/abs/a': FULL })
      const onSelect = vi.fn()
      renderTree('/abs/a', null, onSelect)
      fireEvent.click((await screen.findByText('first')).closest('button') as HTMLElement)
      expect(onSelect).toHaveBeenLastCalledWith({ kind: 'change', project: '/abs/a', change: FULL.changes[0] })
      fireEvent.click(screen.getByRole('button', { name: /^Specs/ }))
      fireEvent.click(screen.getByRole('button', { name: 'beta-cap' }))
      expect(onSelect).toHaveBeenLastCalledWith({ kind: 'file', project: '/abs/a', path: 'openspec/specs/beta-cap/spec.md', title: 'beta-cap' })
      fireEvent.click(screen.getByRole('button', { name: '_debt.md' }))
      expect(onSelect).toHaveBeenLastCalledWith({ kind: 'file', project: '/abs/a', path: 'openspec/_debt.md', title: '_debt.md' })
    })

    it('the selected row is aria-current on an accent-subtle fill with a 2px accent bar; others are not current', async () => {
      wire({ '/abs/a': FULL })
      renderTree('/abs/a', { kind: 'change', project: '/abs/a', change: FULL.changes[1] })
      const second = (await screen.findByText('second')).closest('button') as HTMLElement
      expect(second).toHaveAttribute('aria-current', 'true')
      expect(second).toHaveClass('bg-accent-subtle')
      expect(second.className).not.toMatch(/slate-|dark:/)
      const bar = second.querySelector('[data-selected-bar]')
      expect(bar).toHaveClass('w-0.5', 'bg-accent-fg')
      const first = screen.getByText('first').closest('button') as HTMLElement
      expect(first).not.toHaveAttribute('aria-current')
      expect(first.querySelector('[data-selected-bar]')).toBeNull()
      expect(within(second).getByRole('img', { name: 'Test gần nhất: xanh' })).toHaveClass('text-success-fg')
    })

    it('the selected change row keeps the same approval tones as an idle one: no inverted pair', async () => {
      wire({ '/abs/a': FULL })
      renderTree('/abs/a', { kind: 'change', project: '/abs/a', change: FULL.changes[1] })
      const second = (await screen.findByText('second')).closest('button') as HTMLElement
      expect(within(second).getByText('Plan đã duyệt')).toHaveClass('bg-success-bg', 'text-success-fg')
      const other = within((screen.getByText('first').closest('button') as HTMLElement)).getByText('Plan chưa duyệt')
      expect(other).toHaveClass('bg-warning-bg', 'text-warning-fg')
    })

    it('a selection in another project does not press the same dir here', async () => {
      wire({ '/abs/a': FULL })
      renderTree('/abs/a', { kind: 'change', project: '/abs/b', change: FULL.changes[0] })
      expect(((await screen.findByText('first')).closest('button') as HTMLElement)).not.toHaveAttribute('aria-current')
    })

    it('the selected spec file is aria-current', async () => {
      wire({ '/abs/a': FULL })
      renderTree('/abs/a', { kind: 'file', project: '/abs/a', path: 'openspec/_debt.md', title: '_debt.md' })
      fireEvent.click(await screen.findByRole('button', { name: /^Specs/ }))
      expect(screen.getByRole('button', { name: '_debt.md' })).toHaveAttribute('aria-current', 'true')
      expect(screen.getByRole('button', { name: 'glossary.md' })).not.toHaveAttribute('aria-current')
    })
  })

  describe('adhoc runs', () => {
    const RUNS = [run('fix-b', '2026-03-05', { has_independent: true }), run('fix-a', '2026-03-01'), run('no-date', null)]

    it('UC-003/AC-26 shows a collapsed third group "Việc nhỏ (adhoc)" with its count after Specs', async () => {
      wire({ '/abs/a': tree({ ...FULL, adhoc: RUNS }) })
      renderTree('/abs/a')
      const specs = await screen.findByRole('button', { name: /^Specs/ })
      const group = screen.getByRole('button', { name: /^Việc nhỏ \(adhoc\)/ })
      expect(group).toHaveAttribute('aria-expanded', 'false')
      expect(group).toHaveTextContent('Việc nhỏ (adhoc)(3)')
      expect(specs.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(screen.queryByText('fix-b')).not.toBeInTheDocument()
    })

    it('UC-003/AC-26 lists the runs in the order received, each with its date, the undated one without', async () => {
      wire({ '/abs/a': tree({ adhoc: RUNS }) })
      renderTree('/abs/a')
      fireEvent.click(await screen.findByRole('button', { name: /^Việc nhỏ/ }))
      const slugs = ['fix-b', 'fix-a', 'no-date'].map((s) => screen.getByText(s))
      for (let i = 1; i < slugs.length; i++) {
        expect(slugs[i - 1].compareDocumentPosition(slugs[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      }
      expect(slugs[0]).toHaveClass('truncate', 'flex-1')
      expect(slugs[0]).toHaveAttribute('title', 'fix-b')
      const first = slugs[0].closest('button') as HTMLElement
      expect(within(first).getByText('2026-03-05')).toHaveClass('tabular-nums', 'text-xs', 'text-ink-subtle')
      expect(within(slugs[2].closest('button') as HTMLElement).queryByText(/\d{4}-\d{2}-\d{2}/)).not.toBeInTheDocument()
    })

    it('pressing a run selects it with its row', async () => {
      wire({ '/abs/a': tree({ adhoc: RUNS }) })
      const onSelect = vi.fn()
      renderTree('/abs/a', null, onSelect)
      fireEvent.click(await screen.findByRole('button', { name: /^Việc nhỏ/ }))
      fireEvent.click(screen.getByRole('button', { name: /^fix-a/ }))
      expect(onSelect).toHaveBeenLastCalledWith({ kind: 'adhoc', project: '/abs/a', run: RUNS[1] })
    })

    it('the selected run is aria-current on the accent-subtle row; a run of another project is not', async () => {
      wire({ '/abs/a': tree({ adhoc: RUNS }) })
      const { rerender, qc } = renderTree('/abs/a', { kind: 'adhoc', project: '/abs/a', run: RUNS[0] })
      fireEvent.click(await screen.findByRole('button', { name: /^Việc nhỏ/ }))
      const picked = screen.getByRole('button', { name: /^fix-b/ })
      expect(picked).toHaveAttribute('aria-current', 'true')
      expect(picked).toHaveClass('bg-accent-subtle')
      expect(screen.getByRole('button', { name: /^fix-a/ })).not.toHaveAttribute('aria-current')
      rerender(
        <QueryClientProvider client={qc}>
          <PlanTree project="/abs/a" selected={{ kind: 'adhoc', project: '/abs/b', run: RUNS[0] }} onSelect={() => {}} />
        </QueryClientProvider>,
      )
      expect(screen.getByRole('button', { name: /^fix-b/ })).not.toHaveAttribute('aria-current')
    })

    it('UC-003/AC-26 shows 20 runs and "Hiện thêm 5", which shows the rest and goes away', async () => {
      const many = Array.from({ length: 25 }, (_, i) => run(`job-${String(i).padStart(2, '0')}`))
      wire({ '/abs/a': tree({ adhoc: many }) })
      renderTree('/abs/a')
      fireEvent.click(await screen.findByRole('button', { name: /^Việc nhỏ/ }))
      expect(await screen.findAllByText(/^job-/)).toHaveLength(20)
      const more = screen.getByRole('button', { name: 'Hiện thêm 5' })
      expect(more).not.toHaveClass('btn-ghost')
      fireEvent.click(more)
      expect(screen.getAllByText(/^job-/)).toHaveLength(25)
      expect(screen.queryByRole('button', { name: /Hiện thêm/ })).not.toBeInTheDocument()
    })

    it('empty: the group reads "Chưa có việc nhỏ nào" when opened', async () => {
      wire({ '/abs/a': tree() })
      renderTree('/abs/a')
      const group = await screen.findByRole('button', { name: /^Việc nhỏ/ })
      expect(group).toHaveTextContent('Việc nhỏ (adhoc)(0)')
      fireEvent.click(group)
      expect(screen.getByText('Chưa có việc nhỏ nào')).toBeInTheDocument()
    })

    it('UC-003/AC-27 a project without openspec/ shows the explanation and the group with its runs', async () => {
      wire({ '/abs/a': tree({ openspec: 'missing', adhoc: [run('only-run')] }) })
      renderTree('/abs/a')
      expect(await screen.findByText('Project này chưa có plan agent-hub')).toBeInTheDocument()
      const group = screen.getByRole('button', { name: /^Việc nhỏ \(adhoc\)/ })
      expect(group).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByRole('button', { name: /^Thay đổi/ })).not.toBeInTheDocument()
      fireEvent.click(group)
      expect(screen.getByText('only-run')).toBeInTheDocument()
    })

    it('UC-003/AC-27 in Tất cả the short line and the group show for a project without openspec/', async () => {
      wire({ '/abs/a': tree({ openspec: 'missing', adhoc: [run('only-run')] }) })
      renderTree(null)
      fireEvent.click(await screen.findByRole('button', { name: /alpha/ }))
      expect(await screen.findByText('Chưa có plan agent-hub')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^Việc nhỏ \(adhoc\)/ })).toBeInTheDocument()
    })

    it('UC-003/AC-3 a project without openspec/ and without runs shows no adhoc group', async () => {
      wire({ '/abs/a': tree({ openspec: 'missing' }) })
      renderTree('/abs/a')
      await screen.findByText('Project này chưa có plan agent-hub')
      expect(screen.queryByRole('button', { name: /^Việc nhỏ/ })).not.toBeInTheDocument()
    })

    it.each(THEMES)('the empty text of the group reaches 4.5:1 in %s', async (theme) => {
      wire({ '/abs/a': tree() })
      renderTree('/abs/a')
      fireEvent.click(await screen.findByRole('button', { name: /^Việc nhỏ/ }))
      const empty = screen.getByText('Chưa có việc nhỏ nào')
      expect(ratio(colourOf(empty, 'text', theme), PANE[theme])).toBeGreaterThanOrEqual(4.5)
    })
  })

  describe('projects', () => {
    it('UC-003/AC-1 two registered projects each show their own changes and specs', async () => {
      wire({
        '/abs/a': tree({ changes: [row('only-in-a')], specs: [{ capability: 'cap-a', path: 'openspec/specs/cap-a/spec.md' }] }),
        '/abs/b': tree({ changes: [row('only-in-b')] }),
      })
      renderTree(null)
      expect(await screen.findByText('alpha')).toBeInTheDocument()
      expect(screen.queryByText('only-in-a')).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: /alpha/ }))
      expect(await screen.findByText('only-in-a')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: /beta/ }))
      expect(await screen.findByText('only-in-b')).toBeInTheDocument()
      expect(invokeMock).toHaveBeenCalledWith('plans_tree', { project: '/abs/a' })
      expect(invokeMock).toHaveBeenCalledWith('plans_tree', { project: '/abs/b' })
      expect(screen.getByText('only-in-a')).toBeInTheDocument()
    })

    it('reads nothing for a project that stays collapsed', async () => {
      wire({ '/abs/a': FULL, '/abs/b': FULL })
      renderTree(null)
      await screen.findByText('beta')
      expect(invokeMock).not.toHaveBeenCalledWith('plans_tree', expect.anything())
    })

    it('shows only the picked project, open, when one is picked', async () => {
      wire({ '/abs/a': FULL, '/abs/b': FULL })
      renderTree('/abs/b')
      expect(await screen.findByText('first')).toBeInTheDocument()
      expect(screen.queryByText('alpha')).not.toBeInTheDocument()
      expect(invokeMock).toHaveBeenCalledWith('plans_tree', { project: '/abs/b' })
      expect(invokeMock).not.toHaveBeenCalledWith('plans_tree', { project: '/abs/a' })
    })

    it('switching from Tất cả to one project shows that project open', async () => {
      wire({ '/abs/a': FULL, '/abs/b': FULL })
      const { qc, rerender } = renderTree(null)
      const node = await screen.findByRole('button', { name: /alpha/ })
      expect(node).toHaveAttribute('aria-expanded', 'false')
      rerender(
        <QueryClientProvider client={qc}>
          <PlanTree project="/abs/a" selected={null} onSelect={() => {}} />
        </QueryClientProvider>,
      )
      expect(await screen.findByText('first')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /alpha/ })).toHaveAttribute('aria-expanded', 'true')
    })

    it('says so when no project is registered', async () => {
      invokeMock.mockImplementation(() => Promise.resolve([]))
      renderTree(null)
      expect(await screen.findByText('Chưa có project nào để theo dõi')).toBeInTheDocument()
    })

    it('with no project the empty text points to the Project picker', async () => {
      invokeMock.mockImplementation(() => Promise.resolve([]))
      renderTree(null)
      expect(await screen.findByText('Thêm project từ bộ chọn Project ở thanh bên.')).toBeInTheDocument()
      expect(screen.queryByText(/nút \+/)).toBeNull()
    })
  })

  describe('refresh', () => {
    it('UC-003/AC-28 the project refresh button invalidates [plans, project]', async () => {
      wire({ '/abs/a': FULL })
      const { qc } = renderTree('/abs/a')
      const spy = vi.spyOn(qc, 'invalidateQueries')
      fireEvent.click(await screen.findByRole('button', { name: 'Đọc lại plan và spec' }))
      expect(spy).toHaveBeenCalledWith({ queryKey: ['plans', '/abs/a'] })
    })

    it('UC-003/AC-28 pressing it reads the tree and an open detail of that project again, and no other project', async () => {
      wire({ '/abs/a': FULL })
      const read = vi.fn(() => Promise.resolve('text'))
      function Probe({ project }: { project: string }) {
        useQuery({ queryKey: ['plans', project, 'change', 'openspec/changes/first'], queryFn: read })
        return null
      }
      renderTree('/abs/a', null, () => {}, (
        <>
          <Probe project="/abs/a" />
          <Probe project="/abs/other" />
        </>
      ))
      await screen.findByText('first')
      await waitFor(() => expect(read).toHaveBeenCalledTimes(2))
      const trees = () => invokeMock.mock.calls.filter(([c]) => c === 'plans_tree').length
      expect(trees()).toBe(1)
      fireEvent.click(screen.getByRole('button', { name: 'Đọc lại plan và spec' }))
      await waitFor(() => expect(trees()).toBe(2))
      await waitFor(() => expect(read).toHaveBeenCalledTimes(3))
      expect(read).toHaveBeenCalledTimes(3)
    })

    it('UC-003/AC-2 a change created after the app was built shows on the next read', async () => {
      wire({ '/abs/a': tree({ changes: [row('before')] }) })
      renderTree('/abs/a')
      await screen.findByText('before')
      expect(screen.queryByText('created-later')).not.toBeInTheDocument()
      wire({ '/abs/a': tree({ changes: [row('created-later'), row('before')] }) })
      fireEvent.click(screen.getByRole('button', { name: 'Đọc lại plan và spec' }))
      expect(await screen.findByText('created-later')).toBeInTheDocument()
    })

    it('has no refresh button on a collapsed project', async () => {
      wire({ '/abs/a': FULL })
      renderTree(null)
      await screen.findByText('alpha')
      expect(screen.queryByRole('button', { name: 'Đọc lại plan và spec' })).not.toBeInTheDocument()
    })
  })

  describe('states', () => {
    it('UC-003/AC-3 a project without openspec/ shows the explanation, not an error and no group', async () => {
      wire({ '/abs/a': tree({ openspec: 'missing' }) })
      renderTree('/abs/a')
      expect(await screen.findByText('Project này chưa có plan agent-hub')).toHaveClass('font-semibold')
      expect(screen.getByText(/Chưa thấy thư mục openspec\/\. Thay đổi và spec sẽ hiện ở đây sau khi agent-hub tạo plan đầu tiên trong project\./)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^Thay đổi/ })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^Specs/ })).not.toBeInTheDocument()
      expect(screen.queryByText(/Không đọc được/)).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Thử lại' })).not.toBeInTheDocument()
    })

    it('UC-003/AC-3 in Tất cả a project without openspec/ shows one short line', async () => {
      wire({ '/abs/a': tree({ openspec: 'missing' }) })
      renderTree(null)
      fireEvent.click(await screen.findByRole('button', { name: /alpha/ }))
      expect(await screen.findByText('Chưa có plan agent-hub')).toBeInTheDocument()
      expect(screen.queryByText('Project này chưa có plan agent-hub')).not.toBeInTheDocument()
    })

    it('loading: skeleton rows with aria-busy and an sr-only "Đang tải…", no spinner', () => {
      invokeMock.mockImplementation((cmd: string) => (cmd === 'list_projects' ? Promise.resolve(PROJECTS) : new Promise(() => {})))
      const { container } = renderTree('/abs/a')
      return waitFor(() => {
        expect(container.querySelectorAll('[data-skeleton-row]')).toHaveLength(3)
        expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
        expect(screen.getByText('Đang tải…')).toHaveClass('sr-only')
        expect(container.querySelector('.animate-spin')).toBeNull()
      })
    })

    it('error: "Không đọc được: {message}" with "Thử lại", which reads again', async () => {
      wire({ '/abs/a': new Error('denied') })
      renderTree('/abs/a')
      expect(await screen.findByText('Không đọc được: denied')).toBeInTheDocument()
      wire({ '/abs/a': FULL })
      fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }))
      expect(await screen.findByText('first')).toBeInTheDocument()
      expect(screen.queryByText(/Không đọc được/)).not.toBeInTheDocument()
    })

    it('a failed refetch replaces the old rows with the error and Thử lại', async () => {
      wire({ '/abs/a': FULL })
      renderTree('/abs/a')
      expect(await screen.findByText('first')).toBeInTheDocument()
      wire({ '/abs/a': new Error('denied') })
      fireEvent.click(screen.getByRole('button', { name: 'Đọc lại plan và spec' }))
      expect(await screen.findByText('Không đọc được: denied')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Thử lại' })).toBeInTheDocument()
      expect(screen.queryByText('first')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^Thay đổi/ })).not.toBeInTheDocument()
    })

    it('one project failing leaves the others readable', async () => {
      wire({ '/abs/a': new Error('denied'), '/abs/b': FULL })
      renderTree(null)
      fireEvent.click(await screen.findByRole('button', { name: /alpha/ }))
      fireEvent.click(screen.getByRole('button', { name: /beta/ }))
      expect(await screen.findByText('Không đọc được: denied')).toBeInTheDocument()
      expect(await screen.findByText('first')).toBeInTheDocument()
    })

    it('empty: no change at all reads "Chưa có thay đổi nào", no spec reads "Chưa có spec nào"', async () => {
      wire({ '/abs/a': tree() })
      renderTree('/abs/a')
      expect(await screen.findByText('Chưa có thay đổi nào')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^Đã đóng/ })).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: /^Specs/ }))
      expect(screen.getByText('Chưa có spec nào')).toBeInTheDocument()
    })

    it('empty: only closed changes read "Không có thay đổi nào đang mở" beside the Đã đóng group', async () => {
      wire({ '/abs/a': tree({ changes: [closedRow('old', '2026-10-01')] }) })
      renderTree('/abs/a')
      expect(await screen.findByText('Không có thay đổi nào đang mở')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^Đã đóng/ })).toBeInTheDocument()
    })

    it.each(THEMES)('the empty, explanation and error texts reach 4.5:1 in %s', async (theme) => {
      wire({ '/abs/a': tree(), '/abs/b': new Error('denied') })
      renderTree(null)
      fireEvent.click(await screen.findByRole('button', { name: /alpha/ }))
      fireEvent.click(screen.getByRole('button', { name: /beta/ }))
      const empty = await screen.findByText('Chưa có thay đổi nào')
      const error = await screen.findByText(/Không đọc được: denied/)
      expect(ratio(colourOf(empty, 'text', theme), PANE[theme])).toBeGreaterThanOrEqual(4.5)
      const alert = error.closest('[role="alert"]') as HTMLElement
      expect(ratio(colourOf(alert, 'text', theme), colourOf(alert, 'bg', theme))).toBeGreaterThanOrEqual(4.5)
    })

    it.each(THEMES)('the explanation of a project without openspec/ reaches 4.5:1 in %s', async (theme) => {
      wire({ '/abs/a': tree({ openspec: 'missing' }) })
      renderTree('/abs/a')
      const text = await screen.findByText(/Chưa thấy thư mục openspec\//)
      expect(ratio(colourOf(text, 'text', theme), PANE[theme])).toBeGreaterThanOrEqual(4.5)
    })
  })

  describe('paging', () => {
    const MANY = tree({
      changes: [row('open-one'), ...Array.from({ length: 25 }, (_, i) => closedRow(`done-${String(i).padStart(2, '0')}`, '2026-10-01'))],
    })

    it('Đã đóng shows 20 rows and "Hiện thêm 5", which shows the rest and goes away', async () => {
      wire({ '/abs/a': MANY })
      renderTree('/abs/a')
      fireEvent.click(await screen.findByRole('button', { name: /^Đã đóng/ }))
      expect(await screen.findAllByText(/^done-/)).toHaveLength(20)
      const more = screen.getByRole('button', { name: 'Hiện thêm 5' })
      expect(more).not.toHaveClass('btn-ghost')
      fireEvent.click(more)
      expect(screen.getAllByText(/^done-/)).toHaveLength(25)
      expect(screen.queryByRole('button', { name: /Hiện thêm/ })).not.toBeInTheDocument()
    })

    it('"Hiện thêm" adds at most 20 at a time', async () => {
      const big = tree({ changes: Array.from({ length: 45 }, (_, i) => closedRow(`c-${String(i).padStart(2, '0')}`, '2026-10-01')) })
      wire({ '/abs/a': big })
      renderTree('/abs/a')
      fireEvent.click(await screen.findByRole('button', { name: /^Đã đóng/ }))
      await screen.findAllByText(/^c-/)
      expect(screen.getByRole('button', { name: 'Hiện thêm 20' })).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Hiện thêm 20' }))
      expect(screen.getAllByText(/^c-/)).toHaveLength(40)
      expect(screen.getByRole('button', { name: 'Hiện thêm 5' })).toBeInTheDocument()
    })

    it('a group of 20 or fewer rows has no "Hiện thêm"', async () => {
      wire({ '/abs/a': FULL })
      renderTree('/abs/a')
      fireEvent.click(await screen.findByRole('button', { name: /^Đã đóng/ }))
      await screen.findByText('old-a')
      expect(screen.queryByRole('button', { name: /Hiện thêm/ })).not.toBeInTheDocument()
    })
  })

  describe('read only and the API', () => {
    it('has no approve, stamp, edit or comment control and no field', async () => {
      wire({ '/abs/a': FULL })
      renderTree('/abs/a')
      await screen.findByText('first')
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^(duyệt|approve|stamp|sửa|edit|thêm|add|tạo|gửi)/i })).not.toBeInTheDocument()
    })

    it('every tree row is a button inside a list item and none is a toggle', async () => {
      wire({ '/abs/a': FULL })
      renderTree('/abs/a')
      const first = (await screen.findByText('first')).closest('button') as HTMLElement
      expect(first.closest('li')).not.toBeNull()
      expect(first).not.toHaveAttribute('aria-pressed')
    })

    it('rows have fixed heights: 52px for a change, 32px for a spec and a run', async () => {
      wire({ '/abs/a': tree({ ...FULL, adhoc: [run('fix-a')] }) })
      renderTree('/abs/a')
      expect((await screen.findByText('first')).closest('button')).toHaveClass('h-[52px]')
      fireEvent.click(screen.getByRole('button', { name: /^Specs/ }))
      expect(screen.getByRole('button', { name: '_debt.md' })).toHaveClass('h-8')
      fireEvent.click(screen.getByRole('button', { name: /^Việc nhỏ/ }))
      expect(screen.getByRole('button', { name: /^fix-a/ })).toHaveClass('h-8')
    })

    it('the groups are headings that keep the outline: project 2, group 3, Đã đóng 4', async () => {
      wire({ '/abs/a': FULL })
      renderTree('/abs/a')
      await screen.findByText('first')
      expect(screen.getByRole('heading', { level: 2, name: /alpha/ })).toBeInTheDocument()
      expect(screen.getByRole('heading', { level: 3, name: /^Thay đổi/ })).toBeInTheDocument()
      expect(screen.getByRole('heading', { level: 4, name: /^Đã đóng/ })).toBeInTheDocument()
    })

    it('reads through the api wrapper', () => {
      expect(typeof api.plansTree).toBe('function')
    })
  })
})
