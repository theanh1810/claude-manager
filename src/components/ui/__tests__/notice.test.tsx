import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Loader2 } from 'lucide-react'
import Banner from '../Banner'
import NoticeHost from '../NoticeHost'
import { useNoticeStore } from '@/stores/useNoticeStore'

describe('<Banner />', () => {
  it('a danger banner has role alert and the others role status', () => {
    const { rerender } = render(<Banner tone="danger">Không lưu được</Banner>)
    expect(screen.getByRole('alert')).toHaveTextContent('Không lưu được')
    rerender(<Banner tone="info">Đang lập chỉ mục</Banner>)
    expect(screen.getByRole('status')).toHaveTextContent('Đang lập chỉ mục')
    rerender(<Banner tone="warning">Cần duyệt lại</Banner>)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('a region banner has role region named by its title', () => {
    render(
      <Banner tone="warning" role="region" aria-labelledby="t">
        <span id="t">Cần duyệt lại</span>
      </Banner>
    )
    expect(screen.getByRole('region', { name: 'Cần duyệt lại' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows its title, body and actions, and never takes focus', () => {
    render(
      <Banner tone="success" title="Đã chấp nhận 3 mục" actions={<button>Xem</button>}>
        Xong
      </Banner>
    )
    expect(screen.getByText('Đã chấp nhận 3 mục')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Xem' })).toBeInTheDocument()
    expect(document.body).toHaveFocus()
  })

  it('onDismiss adds an Ẩn thông báo button that calls it', async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()
    render(
      <Banner tone="info" onDismiss={onDismiss}>
        x
      </Banner>
    )
    await user.click(screen.getByRole('button', { name: 'Ẩn thông báo' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('layout decides the frame: bleed has only a bottom line, inline and overlay are rounded', () => {
    const { rerender } = render(<Banner tone="info" layout="bleed">x</Banner>)
    expect(screen.getByRole('status')).toHaveClass('border-b')
    expect(screen.getByRole('status')).not.toHaveClass('rounded-lg')
    rerender(<Banner tone="info" layout="overlay">x</Banner>)
    expect(screen.getByRole('status')).toHaveClass('rounded-lg', 'shadow-popover')
  })
})

describe('<Banner /> icon', () => {
  it('the leading icon turns only with spinIcon', () => {
    const { container, rerender } = render(<Banner tone="info" icon={Loader2}>x</Banner>)
    expect(container.querySelector('svg')).not.toHaveClass('animate-spin')
    rerender(<Banner tone="info" icon={Loader2} spinIcon>x</Banner>)
    expect(container.querySelector('svg')).toHaveClass('animate-spin')
  })
})

describe('<NoticeHost />', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useNoticeStore.getState().clear()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders nothing while there is no notice', () => {
    const { container } = render(<NoticeHost />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows at most three notices, the oldest dropping out', () => {
    render(<NoticeHost />)
    act(() => {
      for (const id of ['a', 'b', 'c', 'd']) useNoticeStore.getState().notify({ id, tone: 'info', children: `thông báo ${id}` })
    })
    expect(screen.queryByText('thông báo a')).toBeNull()
    expect(screen.getAllByRole('status')).toHaveLength(3)
  })

  it('a notice with autoHideMs leaves by itself and one without waits for Ẩn thông báo', async () => {
    render(<NoticeHost />)
    act(() => {
      useNoticeStore.getState().notify({ id: 'ok', tone: 'success', children: 'Đã lưu', autoHideMs: 3000 })
      useNoticeStore.getState().notify({ id: 'bad', tone: 'danger', children: 'Không lưu được' })
    })
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(screen.queryByText('Đã lưu')).toBeNull()
    expect(screen.getByRole('alert')).toHaveTextContent('Không lưu được')
    vi.useRealTimers()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Ẩn thông báo' }))
    expect(screen.queryByText('Không lưu được')).toBeNull()
  })

  it('floats over the content under the header instead of pushing it', () => {
    render(<NoticeHost />)
    act(() => {
      useNoticeStore.getState().notify({ tone: 'info', children: 'x' })
    })
    const host = screen.getByRole('status').parentElement as HTMLElement
    expect(host).toHaveClass('absolute', 'top-header', 'z-sticky', 'w-notice')
  })
})
