import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import SourceLabel from '../SourceLabel'

const RAW_PALETTE = /\b(?:slate|rose|emerald|brand|amber|sky|purple|fuchsia)-\d/

describe('<SourceLabel />', () => {
  it('UC-001/AC-2 a Claude change is labelled with its session and decision, on one line, with token colours only', () => {
    const { container } = render(<SourceLabel edit={{ source: 'claude', session_id: 'a1b2c3d4-eeee', decision: 'accept' }} />)
    const label = screen.getByText('Claude · session a1b2c3d4')
    expect(label).toHaveClass('h-5', 'rounded-sm', 'border', 'border-line', 'bg-accent-subtle', 'text-accent-fg', 'text-xs', 'font-medium', 'px-1.5')
    expect(label).toHaveAttribute('title', 'a1b2c3d4-eeee')
    const decision = screen.getByText('được phép')
    expect(decision).toHaveClass('text-success-fg')
    expect(decision.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(container.firstElementChild).toHaveClass('flex-row', 'items-center', 'whitespace-nowrap')
    expect(container.firstElementChild).not.toHaveClass('flex-col')
    expect(container.innerHTML).not.toMatch(RAW_PALETTE)
  })

  it('a Claude change without a session id reads just Claude', () => {
    render(<SourceLabel edit={{ source: 'claude', session_id: null, decision: 'accept' }} />)
    expect(screen.getByText('Claude')).not.toHaveAttribute('title')
  })

  it('colours each decision by its tone, and the words carry the meaning', () => {
    const { rerender } = render(<SourceLabel edit={{ source: 'claude', session_id: 's-9', decision: 'reject' }} />)
    expect(screen.getByText('bị từ chối')).toHaveClass('text-danger-fg')
    rerender(<SourceLabel edit={{ source: 'claude', session_id: 's-9', decision: null }} />)
    expect(screen.getByText('không rõ quyết định')).toHaveClass('text-ink-muted')
  })

  it('UC-001/AC-2 a change the user saved is labelled as the user\'s, with an icon and a muted token colour', () => {
    const { container } = render(<SourceLabel edit={{ source: 'unknown', session_id: null, decision: null }} />)
    const text = screen.getByText('không rõ / bạn tự sửa')
    expect(text).toHaveClass('text-ink-muted')
    expect(text.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(container.innerHTML).not.toMatch(RAW_PALETTE)
  })

  it('shows Claude, the short session and an allowed call', () => {
    render(<SourceLabel edit={{ source: 'claude', session_id: 'a1b2c3d4-eeee', decision: 'accept' }} />)
    expect(screen.getByText('Claude · session a1b2c3d4')).toBeInTheDocument()
    expect(screen.getByText('được phép')).toBeInTheDocument()
  })

  it('shows a rejected call in words', () => {
    render(<SourceLabel edit={{ source: 'claude', session_id: 's-9', decision: 'reject' }} />)
    expect(screen.getByText('bị từ chối')).toBeInTheDocument()
  })

  it('shows không rõ quyết định when a Claude change has no recorded decision', () => {
    render(<SourceLabel edit={{ source: 'claude', session_id: 's-9', decision: null }} />)
    expect(screen.getByText('không rõ quyết định')).toBeInTheDocument()
    expect(screen.queryByText('được phép')).not.toBeInTheDocument()
  })

  it('shows không rõ quyết định when the decision is absent', () => {
    render(<SourceLabel edit={{ source: 'claude', session_id: 's-9' }} />)
    expect(screen.getByText('không rõ quyết định')).toBeInTheDocument()
  })

  it('shows không rõ for an unmatched change', () => {
    render(<SourceLabel edit={{ source: 'unknown', session_id: null, decision: null }} />)
    expect(screen.getByText('không rõ / bạn tự sửa')).toBeInTheDocument()
  })

  it('shows không rõ when the change was never labelled', () => {
    render(<SourceLabel edit={{ session_id: null }} />)
    expect(screen.getByText('không rõ / bạn tự sửa')).toBeInTheDocument()
  })
})
