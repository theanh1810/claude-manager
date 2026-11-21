// Component tests for the PlansTab shell: the aside shows the plan tree of the project read at run time,
// the detail pane shows the selection, and nothing is discovered at build time.
// UC-003/AC-3, AC-26, AC-27, AC-28, AC-29.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'
import React from 'react'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PlanChangeDetail, PlansTree } from '@/types/spec'

import PlansTab from '../PlansTab'

const invokeMock = vi.mocked(invoke)

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)
  return { qc, wrapper }
}

const NO_TREE: PlansTree = { openspec: 'present', changes: [], specs: [], debt: null, glossary: null, adhoc: [] }

function change(id: string): PlansTree['changes'][number] {
  return {
    id,
    dir: `openspec/changes/${id}`,
    closed: false,
    archived_date: null,
    tasks_done: 1,
    tasks_total: 2,
    tasks_unreadable: false,
    approval: 'not_approved',
    latest_verdict: null,
    modified_at: 1,
  }
}

function detailOf(id: string): PlanChangeDetail {
  return {
    id,
    dir: `openspec/changes/${id}`,
    closed: false,
    archived_date: null,
    approval: 'not_approved',
    tasks: { state: 'ok', done: 1, total: 2, waves: [{ wave: 1, done: 1, total: 2, tasks: [{ id: '1.1', title: `Việc của ${id}`, done: true }, { id: '1.2', title: 'Việc hai', done: false }] }] },
    review: { state: 'missing' },
    errors: { state: 'missing' },
    docs: [{ label: 'plan.vi.md', path: `openspec/changes/${id}/plan.vi.md` }],
  }
}

describe('<PlansTab /> runtime plan view', () => {
  const TREE_A: PlansTree = { ...NO_TREE, changes: [change('chg-a')], specs: [{ capability: 'cap-a', path: 'openspec/specs/cap-a/spec.md' }], debt: 'openspec/_debt.md' }
  const TREE_B: PlansTree = { ...NO_TREE, changes: [change('chg-b')] }

  function wire(trees: Record<string, PlansTree | Error>) {
    invokeMock.mockImplementation((cmd: string, args?: unknown) => {
      const a = (args ?? {}) as { project?: string; dir?: string; relPath?: string }
      if (cmd === 'list_projects') {
        return Promise.resolve([
          { id: 'p1', name: 'alpha', path: '/abs/a', color: null, added_at: '', last_opened_at: null },
          { id: 'p2', name: 'beta', path: '/abs/b', color: null, added_at: '', last_opened_at: null },
        ])
      }
      if (cmd === 'plans_tree') {
        const t = trees[a.project ?? '']
        return t instanceof Error ? Promise.reject(t) : Promise.resolve(t)
      }
      if (cmd === 'plans_change') return Promise.resolve(detailOf((a.dir ?? '').split('/').pop() ?? ''))
      if (cmd === 'plans_read') return Promise.resolve(`Văn bản ${a.relPath}`)
      return Promise.resolve([])
    })
  }

  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('shows the plan tree of the selected project from runtime data', async () => {
    wire({ '/abs/a': TREE_A })
    const { wrapper } = makeWrapper()
    render(<PlansTab project="/abs/a" />, { wrapper })
    expect(await screen.findByText('chg-a')).toBeInTheDocument()
    expect(invokeMock).toHaveBeenCalledWith('plans_tree', { project: '/abs/a' })
  })

  it('the Plans root may shrink below its content', async () => {
    wire({ '/abs/a': TREE_A })
    const { wrapper } = makeWrapper()
    const { container } = render(<PlansTab project="/abs/a" />, { wrapper })
    await screen.findByText('chg-a')
    expect(container.firstElementChild).toHaveClass('min-w-0')
  })

  it('the tree pane is the 320px list pane on tokens and the detail takes the rest', async () => {
    wire({ '/abs/a': TREE_A })
    const { wrapper } = makeWrapper()
    const { container } = render(<PlansTab project="/abs/a" />, { wrapper })
    await screen.findByText('chg-a')
    const aside = container.querySelector('.w-pane') as HTMLElement
    expect(aside).toHaveClass('w-pane', 'shrink-0', 'overflow-y-auto', 'border-r', 'border-line', 'bg-surface-0', 'select-none')
    expect(aside.className).not.toMatch(/slate-|dark:|\bw-64\b/)
    expect(container.querySelectorAll('aside:not([aria-label]):not([aria-labelledby])')).toHaveLength(0)
    const detail = container.querySelector('section') as HTMLElement
    expect(detail).toHaveClass('min-w-0', 'flex-1', 'bg-surface-0')
    expect(container.firstElementChild?.className).not.toMatch(/slate-|dark:/)
  })

  it('with nothing selected the detail pane shows the hint as an empty state with an icon', async () => {
    wire({ '/abs/a': TREE_A })
    const { wrapper } = makeWrapper()
    const { container } = render(<PlansTab project="/abs/a" />, { wrapper })
    await screen.findByText('chg-a')
    const hint = screen.getByText('Chọn một thay đổi, spec hoặc việc nhỏ để xem chi tiết.')
    expect(hint).toHaveClass('text-ink')
    expect(container.querySelector('section svg')).not.toBeNull()
  })

  it('with nothing selected the detail pane shows the hint', async () => {
    wire({ '/abs/a': TREE_A })
    const { wrapper } = makeWrapper()
    render(<PlansTab project="/abs/a" />, { wrapper })
    await screen.findByText('chg-a')
    expect(screen.getByText('Chọn một thay đổi, spec hoặc việc nhỏ để xem chi tiết.')).toBeInTheDocument()
  })

  it('picking a change shows its detail pane; picking a spec file shows the file view', async () => {
    wire({ '/abs/a': TREE_A })
    const { wrapper } = makeWrapper()
    render(<PlansTab project="/abs/a" />, { wrapper })
    fireEvent.click((await screen.findByText('chg-a')).closest('button') as HTMLElement)
    expect(await screen.findByRole('heading', { level: 2, name: 'chg-a' })).toBeInTheDocument()
    expect(await screen.findByText('Việc của chg-a')).toBeInTheDocument()
    expect(invokeMock).toHaveBeenCalledWith('plans_change', { project: '/abs/a', dir: 'openspec/changes/chg-a' })
    expect(screen.queryByText('Chọn một thay đổi, spec hoặc việc nhỏ để xem chi tiết.')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Specs/ }))
    fireEvent.click(screen.getByRole('button', { name: '_debt.md' }))
    expect(await screen.findByRole('heading', { level: 2, name: '_debt.md' })).toBeInTheDocument()
    expect(await screen.findByText('Văn bản openspec/_debt.md')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Tiến độ' })).not.toBeInTheDocument()
  })

  it('switching project shows the second project and clears the selection', async () => {
    wire({ '/abs/a': TREE_A, '/abs/b': TREE_B })
    const { wrapper } = makeWrapper()
    const { rerender } = render(<PlansTab project="/abs/a" />, { wrapper })
    fireEvent.click((await screen.findByText('chg-a')).closest('button') as HTMLElement)
    await screen.findByRole('heading', { level: 2, name: 'chg-a' })
    rerender(<PlansTab project="/abs/b" />)
    expect(await screen.findByText('chg-b')).toBeInTheDocument()
    expect(screen.queryByText('chg-a')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2, name: 'chg-a' })).not.toBeInTheDocument()
    expect(screen.getByText('Chọn một thay đổi, spec hoặc việc nhỏ để xem chi tiết.')).toBeInTheDocument()
  })

  it('UC-003/AC-28 pressing the tree refresh button reads the open detail again', async () => {
    wire({ '/abs/a': TREE_A })
    const { wrapper } = makeWrapper()
    render(<PlansTab project="/abs/a" />, { wrapper })
    fireEvent.click((await screen.findByText('chg-a')).closest('button') as HTMLElement)
    await screen.findByText('Việc của chg-a')
    const reads = (cmd: string) => invokeMock.mock.calls.filter(([c]) => c === cmd).length
    expect([reads('plans_tree'), reads('plans_change'), reads('plans_read')]).toEqual([1, 1, 1])
    fireEvent.click(screen.getByRole('button', { name: 'Đọc lại plan và spec' }))
    await waitFor(() => expect([reads('plans_tree'), reads('plans_change'), reads('plans_read')]).toEqual([2, 2, 2]))
  })

  it('UC-003/AC-3 a project without openspec/ shows the explanation in the aside', async () => {
    wire({ '/abs/a': { ...NO_TREE, openspec: 'missing' } })
    const { wrapper } = makeWrapper()
    render(<PlansTab project="/abs/a" />, { wrapper })
    expect(await screen.findByText('Project này chưa có plan agent-hub')).toBeInTheDocument()
    expect(screen.getByText('Chọn một thay đổi, spec hoặc việc nhỏ để xem chi tiết.')).toBeInTheDocument()
  })

  const RUN = { slug: 'fix-b', date: '2026-03-05', dir: 'docs/changes/adhoc/2026-03-05-fix-b', has_record: true, has_independent: true }

  it('UC-003/AC-26 picking an adhoc run shows its detail: record open, independent.md collapsed', async () => {
    wire({ '/abs/a': { ...TREE_A, adhoc: [RUN] } })
    const { wrapper } = makeWrapper()
    render(<PlansTab project="/abs/a" />, { wrapper })
    fireEvent.click(await screen.findByRole('button', { name: /^Việc nhỏ/ }))
    fireEvent.click(screen.getByRole('button', { name: /^fix-b/ }))
    expect(await screen.findByRole('heading', { level: 2, name: 'fix-b' })).toBeInTheDocument()
    expect(screen.getByText('2026-03-05 · việc nhỏ chạy không qua plan · chỉ đọc')).toBeInTheDocument()
    expect(await screen.findByText(`Văn bản ${RUN.dir}/record.md`)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'independent.md' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Chọn một thay đổi, spec hoặc việc nhỏ để xem chi tiết.')).not.toBeInTheDocument()
    expect(invokeMock).toHaveBeenCalledWith('plans_read', { project: '/abs/a', relPath: `${RUN.dir}/record.md` })
    expect(invokeMock).not.toHaveBeenCalledWith('plans_change', expect.anything())
  })

  it('UC-003/AC-27 a project without openspec/ shows the explanation and its adhoc run opens', async () => {
    wire({ '/abs/a': { ...NO_TREE, openspec: 'missing', adhoc: [RUN] } })
    const { wrapper } = makeWrapper()
    render(<PlansTab project="/abs/a" />, { wrapper })
    expect(await screen.findByText('Project này chưa có plan agent-hub')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Việc nhỏ/ }))
    fireEvent.click(screen.getByRole('button', { name: /^fix-b/ }))
    expect(await screen.findByRole('heading', { level: 2, name: 'fix-b' })).toBeInTheDocument()
  })

  it('switching project clears an adhoc selection', async () => {
    wire({ '/abs/a': { ...TREE_A, adhoc: [RUN] }, '/abs/b': TREE_B })
    const { wrapper } = makeWrapper()
    const { rerender } = render(<PlansTab project="/abs/a" />, { wrapper })
    fireEvent.click(await screen.findByRole('button', { name: /^Việc nhỏ/ }))
    fireEvent.click(screen.getByRole('button', { name: /^fix-b/ }))
    await screen.findByRole('heading', { level: 2, name: 'fix-b' })
    rerender(<PlansTab project="/abs/b" />)
    await screen.findByText('chg-b')
    expect(screen.queryByRole('heading', { level: 2, name: 'fix-b' })).not.toBeInTheDocument()
    expect(screen.getByText('Chọn một thay đổi, spec hoặc việc nhỏ để xem chi tiết.')).toBeInTheDocument()
  })

  it('mounts the plan tree, the change pane and the adhoc detail', async () => {
    wire({ '/abs/a': { ...TREE_A, adhoc: [RUN] } })
    const { wrapper } = makeWrapper()
    render(<PlansTab project="/abs/a" />, { wrapper })
    fireEvent.click((await screen.findByText('chg-a')).closest('button') as HTMLElement)
    expect(await screen.findByRole('region', { name: 'Tiến độ' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Việc nhỏ/ }))
    fireEvent.click(screen.getByRole('button', { name: /^fix-b/ }))
    expect(await screen.findByRole('heading', { level: 2, name: 'fix-b' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Tiến độ' })).not.toBeInTheDocument()
  })

  it('a failing plan read shows its error', async () => {
    wire({ '/abs/a': new Error('denied') })
    const { wrapper } = makeWrapper()
    render(<PlansTab project="/abs/a" />, { wrapper })
    expect(await screen.findByText(/Không đọc được: denied/)).toBeInTheDocument()
  })

  it('without a project prop the plan tree is not shown and no plan command runs', () => {
    wire({})
    const { wrapper } = makeWrapper()
    render(<PlansTab />, { wrapper })
    expect(screen.getByText('Chọn một thay đổi, spec hoặc việc nhỏ để xem chi tiết.')).toBeInTheDocument()
    expect(invokeMock).not.toHaveBeenCalledWith('plans_tree', expect.anything())
  })
})

describe('<PlansTab /> source', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const src = readFileSync(join(here, '..', 'PlansTab.tsx'), 'utf8')

  it('UC-003/AC-29 holds no build-time plan glob and no docs/plan path', () => {
    expect(src).not.toContain('import.meta.glob')
    expect(src).not.toContain('docs/plan')
  })
})
