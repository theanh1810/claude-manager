import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AlertCircle, AlertTriangle, Brain, Check, CheckCheck, Clock, Hourglass, Lock, Undo2, X, XCircle } from 'lucide-react'
import StatusMark, { STATUS_MARKS } from '../StatusMark'
import ProgressBar from '../ProgressBar'
import Skeleton from '../Skeleton'

// tokens.md section 2.4: one tone, icon and Vietnamese label per state.
const TABLE = [
  ['edit', 'pending', 'warning', Clock, 'Chờ'],
  ['edit', 'pending_decision', 'info', Hourglass, 'Chờ quyết định'],
  ['edit', 'accepted', 'success', Check, 'Đã chấp nhận'],
  ['edit', 'rejected', 'danger', X, 'Đã từ chối'],
  ['edit', 'rolled_back', 'neutral', Undo2, 'Đã hoàn tác'],
  ['edit', 'auto_accepted', 'info', CheckCheck, 'Tự chấp nhận'],
  ['memory', 'memory', 'info', Brain, 'Memory'],
  ['memory', 'error', 'danger', AlertCircle, 'Lỗi'],
  ['approval', 'approved', 'success', Check, 'Plan đã duyệt'],
  ['approval', 'not_approved', 'warning', Clock, 'Plan chưa duyệt'],
  ['approval', 'stale', 'danger', AlertTriangle, 'Cần duyệt lại'],
  ['verdict', 'red', 'danger', XCircle, 'Đỏ'],
  ['verdict', 'yellow', 'warning', AlertTriangle, 'Vàng'],
  ['verdict', 'green', 'success', Check, 'Xanh'],
  ['mark', 'closed', 'neutral', Lock, 'Đã đóng'],
  ['mark', 'readonly', 'neutral', Lock, 'Chỉ đọc']
] as const

describe('<StatusMark />', () => {
  it.each(TABLE)('%s/%s maps to the %s tone, its icon and the label %s', (kind, value, tone, icon, label) => {
    const entry = (STATUS_MARKS[kind] as Record<string, { tone: string; icon: unknown; label: string }>)[value]
    expect(entry).toEqual({ tone, icon, label })
  })

  it('keeps every mark in one table with no state left out', () => {
    const rows = Object.values(STATUS_MARKS).reduce((n, group) => n + Object.keys(group).length, 0)
    expect(rows).toBe(TABLE.length)
  })

  it('renders the label with the tone classes of the table', () => {
    render(<StatusMark kind="edit" value="accepted" />)
    const badge = screen.getByText('Đã chấp nhận').closest('span') as HTMLElement
    expect(badge).toHaveClass('bg-success-bg', 'text-success-fg')
  })

  it('compact renders an image named by the label', () => {
    render(<StatusMark kind="verdict" value="red" compact />)
    expect(screen.getByRole('img', { name: 'Đỏ' })).toBeInTheDocument()
  })

  it('renders nothing for a value outside the contract', () => {
    const { container } = render(<StatusMark kind="edit" value={'bogus' as 'pending'} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('<ProgressBar />', () => {
  it('exposes role progressbar with its value, range and label', () => {
    render(<ProgressBar value={3} max={10} label="Tiến độ task" />)
    const bar = screen.getByRole('progressbar', { name: 'Tiến độ task' })
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '10')
    expect(bar).toHaveAttribute('aria-valuenow', '3')
  })

  it('moves by scaleX only, never by width', () => {
    render(<ProgressBar value={4} max={10} label="x" />)
    const fill = screen.getByRole('progressbar').firstElementChild as HTMLElement
    expect(fill.style.transform).toBe('scaleX(0.4)')
    expect(fill.style.width).toBe('')
    expect(fill).toHaveClass('origin-left', 'w-full')
  })

  it('clamps a value past the range and an empty range', () => {
    const { rerender } = render(<ProgressBar value={15} max={10} label="x" />)
    expect((screen.getByRole('progressbar').firstElementChild as HTMLElement).style.transform).toBe('scaleX(1)')
    rerender(<ProgressBar value={2} max={0} label="x" />)
    expect((screen.getByRole('progressbar').firstElementChild as HTMLElement).style.transform).toBe('scaleX(0)')
  })

  it('animates only when asked and shows the number beside the bar on request', () => {
    const { rerender } = render(<ProgressBar value={3} max={10} label="x" />)
    expect(screen.getByRole('progressbar').firstElementChild).not.toHaveClass('transition-transform')
    expect(screen.queryByText('3/10')).toBeNull()
    rerender(<ProgressBar value={3} max={10} label="x" animated showValue tone="accent" />)
    expect(screen.getByRole('progressbar').firstElementChild).toHaveClass('transition-transform', 'bg-accent-fg')
    expect(screen.getByText('3/10')).toBeInTheDocument()
  })
})

describe('<Skeleton />', () => {
  it('Rows renders the given count at the given height, busy, with a hidden loading text', () => {
    const { container } = render(<Skeleton.Rows count={3} height={72} />)
    const busy = container.firstElementChild as HTMLElement
    expect(busy).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('Đang tải…')).toHaveClass('sr-only')
    const rows = busy.querySelectorAll('[data-skeleton-row]')
    expect(rows).toHaveLength(3)
    rows.forEach((r) => {
      expect((r as HTMLElement).style.height).toBe('72px')
      expect(r).toHaveAttribute('aria-hidden', 'true')
    })
  })

  it('Block keeps the height of the content it stands for', () => {
    const { container } = render(<Skeleton.Block height={108} />)
    expect(container.firstElementChild).toHaveAttribute('aria-busy', 'true')
    expect((container.querySelector('[data-skeleton-block]') as HTMLElement).style.height).toBe('108px')
  })

  it('a bare Skeleton is a pulsing surface-2 bar that assistive tech skips', () => {
    const { container } = render(<Skeleton height={12} width={80} />)
    const bar = container.firstElementChild as HTMLElement
    expect(bar).toHaveAttribute('aria-hidden', 'true')
    expect(bar).toHaveClass('bg-surface-2', 'animate-pulse-soft')
    expect(bar.style.width).toBe('80px')
  })
})
