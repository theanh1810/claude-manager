import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Inbox } from 'lucide-react'
import EmptyState from '../EmptyState'
import ErrorState from '../ErrorState'
import Disclosure from '../Disclosure'

describe('<ErrorState />', () => {
  it('is an alert whose Thử lại button calls retry once per press', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(<ErrorState title="Lỗi tải memory." detail="ENOENT ~/.claude" onRetry={onRetry} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Lỗi tải memory.')
    expect(screen.getByText('ENOENT ~/.claude')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Thử lại' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Thử lại' }))
    expect(onRetry).toHaveBeenCalledTimes(2)
  })

  it('while retrying the button is busy and presses do nothing', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(<ErrorState title="Lỗi" onRetry={onRetry} retrying />)
    const b = screen.getByRole('button', { name: 'Thử lại' })
    expect(b).toHaveAttribute('aria-busy', 'true')
    await user.click(b)
    expect(onRetry).not.toHaveBeenCalled()
  })

  it('has no button without a retry handler and takes another label', () => {
    const { rerender } = render(<ErrorState title="Lỗi" />)
    expect(screen.queryByRole('button')).toBeNull()
    rerender(<ErrorState title="Lỗi" onRetry={() => {}} retryLabel="Tải lại màn này" />)
    expect(screen.getByRole('button', { name: 'Tải lại màn này' })).toBeInTheDocument()
  })

  it('the inline form is an alert with the retry button too', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(<ErrorState variant="inline" title="Không đọc được" onRetry={onRetry} extra={<span>thêm</span>} />)
    expect(screen.getByRole('alert')).toHaveClass('bg-danger-bg')
    expect(screen.getByText('thêm')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Thử lại' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})

describe('<EmptyState />', () => {
  it('the block form shows title, description and action', () => {
    render(<EmptyState icon={Inbox} title="Không còn thay đổi nào chờ duyệt" description="Thay đổi mới sẽ hiện ở đây." action={<button>Mở</button>} />)
    expect(screen.getByText('Không còn thay đổi nào chờ duyệt')).toBeInTheDocument()
    expect(screen.getByText('Thay đổi mới sẽ hiện ở đây.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mở' })).toBeInTheDocument()
  })

  it('the block form fills its container, the inline form is one line', () => {
    const { container, rerender } = render(<EmptyState icon={Inbox} title="Trống" />)
    expect(container.firstElementChild).toHaveClass('h-full', 'justify-center')
    rerender(<EmptyState icon={Inbox} title="Không có mục nào" variant="inline" />)
    expect(container.firstElementChild).not.toHaveClass('h-full')
    expect(screen.getByText('Không có mục nào')).toBeInTheDocument()
  })

  it('has no live-region role: its content is static', () => {
    render(<EmptyState icon={Inbox} title="Trống" />)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('<Disclosure />', () => {
  it('wraps its button in the given heading level with aria-expanded', async () => {
    const user = userEvent.setup()
    render(
      <Disclosure title="Tài liệu" level={4}>
        <p>nội dung</p>
      </Disclosure>
    )
    const heading = screen.getByRole('heading', { level: 4 })
    const button = within(heading).getByRole('button', { name: /Tài liệu/ })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    await user.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(button).toHaveAttribute('aria-controls', screen.getByText('nội dung').parentElement?.id)
  })

  it('renders no children while closed and mounts them on open', async () => {
    const user = userEvent.setup()
    render(
      <Disclosure title="Tài liệu" level={3}>
        <p>nội dung</p>
      </Disclosure>
    )
    expect(screen.queryByText('nội dung')).toBeNull()
    await user.click(screen.getByRole('button'))
    expect(screen.getByText('nội dung')).toBeInTheDocument()
    await user.click(screen.getByRole('button'))
    expect(screen.queryByText('nội dung')).toBeNull()
  })

  it('works controlled and reports changes', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(
      <Disclosure title="Tài liệu" level={2} open={false} onOpenChange={onOpenChange}>
        <p>nội dung</p>
      </Disclosure>
    )
    await user.click(screen.getByRole('button'))
    expect(onOpenChange).toHaveBeenCalledWith(true)
    expect(screen.queryByText('nội dung')).toBeNull()
  })

  it('can start open, shows a count and an aside, and a long document panel is a labelled region', () => {
    render(
      <Disclosure title="Phiên" level={3} defaultOpen count={4} aside="4 mục · 2 KB" region>
        <p>nội dung</p>
      </Disclosure>
    )
    const button = screen.getByRole('button')
    expect(button).toHaveTextContent('(4)')
    expect(button).toHaveTextContent('4 mục · 2 KB')
    expect(screen.getByRole('region', { name: /Phiên/ })).toHaveTextContent('nội dung')
  })
})
