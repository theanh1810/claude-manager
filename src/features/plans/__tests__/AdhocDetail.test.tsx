// Adhoc run detail (design brief S4).
// UC-003/AC-26 the record opens, independent.md stays collapsed, nothing is editable.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'
import type { AdhocRow } from '@/types/spec'
import AdhocDetail from '../AdhocDetail'
import { colourOf, PANE, ratio, THEMES } from './contrast'

const invokeMock = vi.mocked(invoke)
const PROJECT = '/abs/project'
const DIR = 'docs/changes/adhoc/2026-03-05-fix-b'

const RUN: AdhocRow = { slug: 'fix-b', date: '2026-03-05', dir: DIR, has_record: true, has_independent: true }

function wire(failing: string[] = []) {
  invokeMock.mockImplementation((cmd: string, args?: unknown) => {
    const a = (args ?? {}) as { relPath?: string }
    if (cmd !== 'plans_read') return Promise.resolve([])
    if (failing.includes(a.relPath ?? '')) return Promise.reject(new Error('gone'))
    return Promise.resolve(`Nội dung của ${a.relPath}`)
  })
}

function renderDetail(run: AdhocRow = RUN) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const out = render(
    <QueryClientProvider client={qc}>
      <AdhocDetail project={PROJECT} run={run} />
    </QueryClientProvider>,
  )
  return { qc, ...out }
}

const reads = () => invokeMock.mock.calls.filter(([c]) => c === 'plans_read').map(([, a]) => (a as { relPath: string }).relPath)

describe('<AdhocDetail />', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('shows the slug as the heading and the date line under it', () => {
    wire()
    renderDetail()
    const h2 = screen.getByRole('heading', { level: 2, name: 'fix-b' })
    expect(h2).toHaveClass('font-mono')
    expect(screen.getByText('2026-03-05 · việc nhỏ chạy không qua plan · chỉ đọc')).toBeInTheDocument()
  })

  it('shows where the run sits: the project folder, the adhoc group and the slug as the current page', () => {
    wire()
    renderDetail()
    const nav = screen.getByRole('navigation', { name: 'Vị trí' })
    const items = within(nav).getAllByRole('listitem')
    expect(items.map((i) => i.textContent)).toEqual(['project', 'Việc nhỏ (adhoc)', 'fix-b'])
    expect(items[2]).toHaveAttribute('aria-current', 'page')
  })

  it('the documents sit under a Tài liệu heading one level below the slug, kept for assistive tech only', () => {
    wire()
    renderDetail()
    const h3 = screen.getByRole('heading', { level: 3, name: 'Tài liệu' })
    expect(h3).toHaveClass('sr-only')
  })

  it('without record.md the missing record is an inline empty state with an icon', () => {
    wire()
    renderDetail({ ...RUN, has_record: false, has_independent: false })
    const note = screen.getByText('Chưa có record.md')
    expect(note.querySelector('svg')).not.toBeNull()
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument()
  })

  it('a run without a date keeps the line without the date', () => {
    wire()
    renderDetail({ ...RUN, date: null })
    expect(screen.getByText('việc nhỏ chạy không qua plan · chỉ đọc')).toBeInTheDocument()
  })

  it('UC-003/AC-26 record.md is open and independent.md is listed collapsed and not read', async () => {
    wire()
    renderDetail()
    const record = screen.getByRole('button', { name: 'record.md' })
    const independent = screen.getByRole('button', { name: 'independent.md' })
    expect(record).toHaveAttribute('aria-expanded', 'true')
    expect(independent).toHaveAttribute('aria-expanded', 'false')
    expect(await screen.findByText(`Nội dung của ${DIR}/record.md`)).toBeInTheDocument()
    expect(reads()).toEqual([`${DIR}/record.md`])
    expect(invokeMock).toHaveBeenCalledWith('plans_read', { project: PROJECT, relPath: `${DIR}/record.md` })
  })

  it('opening independent.md reads it and keeps the record open', async () => {
    wire()
    renderDetail()
    fireEvent.click(screen.getByRole('button', { name: 'independent.md' }))
    expect(await screen.findByText(`Nội dung của ${DIR}/independent.md`)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'record.md' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('lists record.md alone when there is no independent.md', async () => {
    wire()
    renderDetail({ ...RUN, has_independent: false })
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['record.md'])
    await screen.findByText(`Nội dung của ${DIR}/record.md`)
    expect(reads()).toEqual([`${DIR}/record.md`])
  })

  it('without record.md it says "Chưa có record.md", lists no record and reads none', async () => {
    wire()
    renderDetail({ ...RUN, has_record: false, has_independent: false })
    expect(screen.getByText('Chưa có record.md')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(reads()).toEqual([])
  })

  it('without record.md a present independent.md is still listed', async () => {
    wire()
    renderDetail({ ...RUN, has_record: false })
    expect(screen.getByText('Chưa có record.md')).toBeInTheDocument()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['independent.md'])
    expect(await screen.findByText(`Nội dung của ${DIR}/independent.md`)).toBeInTheDocument()
  })

  it('UC-003/E1 an unreadable record shows its error and leaves independent.md readable', async () => {
    wire([`${DIR}/record.md`])
    renderDetail()
    expect(await screen.findByText('Không đọc được: gone')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'independent.md' }))
    expect(await screen.findByText(`Nội dung của ${DIR}/independent.md`)).toBeInTheDocument()
  })

  it('read the files under [plans, project, read, path] so the tree refresh reads them again', async () => {
    wire()
    const { qc } = renderDetail()
    await screen.findByText(`Nội dung của ${DIR}/record.md`)
    expect(qc.getQueryData(['plans', PROJECT, 'read', `${DIR}/record.md`])).toBe(`Nội dung của ${DIR}/record.md`)
  })

  it('UC-003/AC-26 is read only: no field and no control but the document toggles', () => {
    wire()
    renderDetail()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    const names = screen.getAllByRole('button').map((b) => b.textContent)
    expect(names).toEqual(['record.md', 'independent.md'])
  })

  it('the pane names no approval, closed state or other change control', () => {
    wire()
    const { container } = renderDetail()
    expect(within(container).queryByText(/duyệt|đã đóng/i)).not.toBeInTheDocument()
  })

  it.each(THEMES)('the date line reaches 4.5:1 in %s', (theme) => {
    wire()
    renderDetail()
    const line = screen.getByText(/việc nhỏ chạy không qua plan/)
    expect(ratio(colourOf(line, 'text', theme), PANE[theme])).toBeGreaterThanOrEqual(4.5)
  })
})
