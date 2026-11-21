// Document accordion of a change (design brief S2 "Tài liệu").
// UC-003/AC-9 plan.vi.md first and open; UC-003/E1 an unreadable document leaves the rest shown.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'
import type { PlanDocRef } from '@/types/spec'
import DocAccordion, { FileText } from '../DocAccordion'
import { colourOf, PANE, ratio, THEMES } from './contrast'

const invokeMock = vi.mocked(invoke)

const DOCS: PlanDocRef[] = [
  { label: 'plan.vi.md', path: 'openspec/changes/demo/plan.vi.md' },
  { label: 'proposal.md', path: 'openspec/changes/demo/proposal.md' },
  { label: 'design.md', path: 'openspec/changes/demo/design.md' },
  { label: 'specs/auth/spec.md', path: 'openspec/changes/demo/specs/auth/spec.md' },
]

function wire(failing: string[] = []) {
  invokeMock.mockImplementation((cmd: string, args?: unknown) => {
    const a = (args ?? {}) as { relPath?: string }
    if (cmd !== 'plans_read') return Promise.resolve([])
    if (failing.includes(a.relPath ?? '')) return Promise.reject(new Error('gone'))
    return Promise.resolve(`Nội dung của ${a.relPath}`)
  })
}

function renderWith(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const out = render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
  return { qc, ...out }
}

describe('<DocAccordion />', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('UC-003/AC-9 lists the documents in the order given and opens only the first, reading only that one', async () => {
    wire()
    renderWith(<DocAccordion project="/abs/project" docs={DOCS} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(DOCS.map((d) => d.label))
    expect(buttons[0]).toHaveAttribute('aria-expanded', 'true')
    for (const b of buttons.slice(1)) expect(b).toHaveAttribute('aria-expanded', 'false')
    expect(await screen.findByText(/Nội dung của openspec\/changes\/demo\/plan\.vi\.md/)).toBeInTheDocument()
    const reads = invokeMock.mock.calls.filter(([cmd]) => cmd === 'plans_read')
    expect(reads).toEqual([['plans_read', { project: '/abs/project', relPath: 'openspec/changes/demo/plan.vi.md' }]])
  })

  it('shows "Đang tải…" in the open document while it reads', async () => {
    invokeMock.mockImplementation(() => new Promise(() => {}))
    renderWith(<DocAccordion project="/abs/project" docs={DOCS} />)
    expect(await screen.findByText('Đang tải…')).toBeInTheDocument()
  })

  it('several documents stay open at once', async () => {
    wire()
    renderWith(<DocAccordion project="/abs/project" docs={DOCS} />)
    fireEvent.click(screen.getByRole('button', { name: 'design.md' }))
    expect(await screen.findByText(/Nội dung của openspec\/changes\/demo\/design\.md/)).toBeInTheDocument()
    expect(screen.getByText(/Nội dung của openspec\/changes\/demo\/plan\.vi\.md/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'plan.vi.md' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('a document closes again from its button and names the panel it controls', async () => {
    wire()
    renderWith(<DocAccordion project="/abs/project" docs={DOCS} />)
    const first = screen.getByRole('button', { name: 'plan.vi.md' })
    const text = await screen.findByText(/Nội dung của openspec\/changes\/demo\/plan\.vi\.md/)
    expect(first).toHaveAttribute('aria-controls', text.closest('[id]')?.id)
    fireEvent.click(first)
    expect(first).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/Nội dung của openspec\/changes\/demo\/plan\.vi\.md/)).not.toBeInTheDocument()
  })

  it('reads through plansRead under the key [plans, project, read, path]', async () => {
    wire()
    const { qc } = renderWith(<DocAccordion project="/abs/project" docs={DOCS} />)
    await screen.findByText(/Nội dung của/)
    expect(qc.getQueryData(['plans', '/abs/project', 'read', 'openspec/changes/demo/plan.vi.md'])).toBe(
      'Nội dung của openspec/changes/demo/plan.vi.md',
    )
  })

  it('UC-003/E1 a document that cannot be read shows its error in its own item only', async () => {
    wire(['openspec/changes/demo/proposal.md'])
    renderWith(<DocAccordion project="/abs/project" docs={DOCS} />)
    await screen.findByText(/Nội dung của openspec\/changes\/demo\/plan\.vi\.md/)
    fireEvent.click(screen.getByRole('button', { name: 'proposal.md' }))
    const error = await screen.findByText('Không đọc được: gone')
    expect(error.closest('li')).toContainElement(screen.getByRole('button', { name: 'proposal.md' }))
    expect(screen.getAllByText(/Không đọc được/)).toHaveLength(1)
    expect(screen.getByText(/Nội dung của openspec\/changes\/demo\/plan\.vi\.md/)).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(DOCS.length)
  })

  it.each(THEMES)('the error text reaches 4.5:1 in %s', async (theme) => {
    wire(['openspec/changes/demo/plan.vi.md'])
    renderWith(<DocAccordion project="/abs/project" docs={DOCS} />)
    const alert = (await screen.findByText('Không đọc được: gone')).closest('[role="alert"]') as HTMLElement
    expect(ratio(colourOf(alert, 'text', theme), colourOf(alert, 'bg', theme))).toBeGreaterThanOrEqual(4.5)
  })

  it('has no field and no control beyond the document buttons', async () => {
    wire()
    renderWith(<DocAccordion project="/abs/project" docs={DOCS} />)
    await screen.findByText(/Nội dung của/)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(DOCS.length)
  })
})

describe('<FileText />', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('shows a .md file as markdown', async () => {
    invokeMock.mockImplementation(() => Promise.resolve('# Tiêu đề'))
    renderWith(<FileText project="/abs/project" path="openspec/changes/demo/plan.vi.md" />)
    expect(await screen.findByRole('heading', { level: 5, name: 'Tiêu đề' })).toBeInTheDocument()
  })

  it('takes the heading level the pane gives it', async () => {
    invokeMock.mockImplementation(() => Promise.resolve('# Tiêu đề'))
    renderWith(<FileText project="/abs/project" path="openspec/specs/a/spec.md" headingLevel={3} />)
    expect(await screen.findByRole('heading', { level: 3, name: 'Tiêu đề' })).toBeInTheDocument()
  })
})

describe('<DocAccordion /> on the Disclosure primitive', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('each document is a level 4 heading in the file name font, and an open one is a region named by it', async () => {
    wire()
    renderWith(<DocAccordion project="/abs/project" docs={DOCS} />)
    const heads = screen.getAllByRole('heading', { level: 4 })
    expect(heads.map((h) => h.textContent)).toEqual(DOCS.map((d) => d.label))
    expect(within(heads[0]).getByText('plan.vi.md')).toHaveClass('font-mono', 'text-sm')
    expect(screen.getByRole('region', { name: 'plan.vi.md' })).toBeInTheDocument()
    expect(await screen.findByText(/Nội dung của/)).toBeInTheDocument()
  })

  it('a document that fails is an inline alert inside its own item, with the danger tokens', async () => {
    wire(['openspec/changes/demo/plan.vi.md'])
    renderWith(<DocAccordion project="/abs/project" docs={DOCS} />)
    const alert = (await screen.findByText('Không đọc được: gone')).closest('[role="alert"]') as HTMLElement
    expect(alert).toHaveClass('bg-danger-bg', 'text-danger-fg')
    expect(alert.closest('li')).toContainElement(screen.getByRole('button', { name: 'plan.vi.md' }))
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  it('loading reads "Đang tải…" in muted text on the pane', async () => {
    invokeMock.mockImplementation(() => new Promise(() => {}))
    renderWith(<DocAccordion project="/abs/project" docs={DOCS} />)
    const note = await screen.findByText('Đang tải…')
    for (const theme of THEMES) expect(ratio(colourOf(note, 'text', theme), PANE[theme])).toBeGreaterThanOrEqual(4.5)
  })
})
