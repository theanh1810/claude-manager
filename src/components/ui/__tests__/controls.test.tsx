import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Check } from 'lucide-react'
import Button from '../Button'
import IconButton from '../IconButton'
import Tooltip from '../Tooltip'
import Badge, { NavCount } from '../Badge'

const RAW_PALETTE = /\b(?:bg|text|border|ring)-(?:slate|gray|rose|amber|emerald|sky|indigo|brand|white|black)\b/

afterEach(() => {
  vi.useRealTimers()
})

describe('<Button />', () => {
  const variants = ['primary', 'secondary', 'ghost', 'success', 'danger', 'danger-subtle', 'warning', 'accent-subtle'] as const

  it.each(variants)('the %s variant uses token classes only', (variant) => {
    render(<Button variant={variant}>Lưu</Button>)
    const cls = screen.getByRole('button', { name: 'Lưu' }).className
    expect(cls).not.toMatch(RAW_PALETTE)
    expect(cls).not.toMatch(/dark:|transition-(?:colors|all)|outline-none/)
  })

  it('primary paints accent with on-accent text, secondary paints surface-2 with a strong line', () => {
    render(
      <>
        <Button variant="primary">A</Button>
        <Button variant="secondary">B</Button>
      </>
    )
    expect(screen.getByRole('button', { name: 'A' })).toHaveClass('bg-accent', 'text-accent-on', 'hover:bg-accent-hover')
    expect(screen.getByRole('button', { name: 'B' })).toHaveClass('bg-surface-2', 'border-line-strong')
  })

  it('sizes are 28, 32 and 36px high and default to md, type button', () => {
    render(
      <>
        <Button size="sm">S</Button>
        <Button>M</Button>
        <Button size="lg">L</Button>
      </>
    )
    expect(screen.getByRole('button', { name: 'S' })).toHaveClass('h-7')
    expect(screen.getByRole('button', { name: 'M' })).toHaveClass('h-8')
    expect(screen.getByRole('button', { name: 'M' })).toHaveAttribute('type', 'button')
    expect(screen.getByRole('button', { name: 'L' })).toHaveClass('h-9')
  })

  it('a toggle exposes aria-pressed and a pressed one switches to the accent-subtle surface', () => {
    const { rerender } = render(<Button pressed={false}>Chỉ Claude</Button>)
    const b = screen.getByRole('button', { name: 'Chỉ Claude' })
    expect(b).toHaveAttribute('aria-pressed', 'false')
    rerender(<Button pressed>Chỉ Claude</Button>)
    expect(b).toHaveAttribute('aria-pressed', 'true')
    expect(b).toHaveClass('bg-accent-subtle')
  })

  it('a button that is not a toggle has no aria-pressed', () => {
    render(<Button>Lưu</Button>)
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-pressed')
  })

  it('loading shows a spinner, sets aria-busy, disables the button and keeps the label', () => {
    const onClick = vi.fn()
    render(
      <Button loading icon={Check} onClick={onClick}>
        Lưu
      </Button>
    )
    const b = screen.getByRole('button', { name: 'Lưu' })
    expect(b).toHaveAttribute('aria-busy', 'true')
    expect(b).toBeDisabled()
    expect(b.querySelector('svg.animate-spin')).not.toBeNull()
    fireEvent.click(b)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('shows the key chip next to the label', () => {
    render(<Button kbd="A">Chấp nhận</Button>)
    expect(screen.getByText('A').tagName).toBe('KBD')
  })
})

describe('<IconButton />', () => {
  it('takes its accessible name from the required label', () => {
    render(<IconButton label="Đóng" icon={Check} />)
    expect(screen.getByRole('button', { name: 'Đóng' })).toBeInTheDocument()
  })

  it('does not type-check without a label', () => {
    // @ts-expect-error label is required: an icon-only button needs a name
    render(<IconButton icon={Check} />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('a toggle exposes aria-pressed', () => {
    render(<IconButton label="Thu gọn thanh bên" icon={Check} pressed />)
    expect(screen.getByRole('button', { name: 'Thu gọn thanh bên' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('loading sets aria-busy and swaps the icon for a spinner', () => {
    render(<IconButton label="Tải lại" icon={Check} loading />)
    const b = screen.getByRole('button', { name: 'Tải lại' })
    expect(b).toHaveAttribute('aria-busy', 'true')
    expect(b.querySelector('svg.animate-spin')).not.toBeNull()
  })

  it('sizes are 28, 32 and 40px', () => {
    render(
      <>
        <IconButton label="a" icon={Check} size="sm" />
        <IconButton label="b" icon={Check} />
        <IconButton label="c" icon={Check} size="rail" />
      </>
    )
    expect(screen.getByRole('button', { name: 'a' })).toHaveClass('size-7')
    expect(screen.getByRole('button', { name: 'b' })).toHaveClass('size-8')
    expect(screen.getByRole('button', { name: 'c' })).toHaveClass('size-10')
  })
})

describe('<Tooltip />', () => {
  it('opens after 400ms of hover and closes on leave', () => {
    vi.useFakeTimers()
    render(
      <Tooltip content="Đóng">
        <button>x</button>
      </Tooltip>
    )
    fireEvent.mouseEnter(screen.getByRole('button'))
    act(() => vi.advanceTimersByTime(399))
    expect(screen.queryByRole('tooltip')).toBeNull()
    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByRole('tooltip')).toHaveTextContent('Đóng')
    expect(screen.getByRole('button')).toHaveAttribute('aria-describedby', screen.getByRole('tooltip').id)
    fireEvent.mouseLeave(screen.getByRole('button'))
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('opens at once on keyboard focus and Esc closes it', async () => {
    const user = userEvent.setup()
    render(
      <Tooltip content="Mở rộng thanh bên">
        <button>x</button>
      </Tooltip>
    )
    await user.tab()
    expect(screen.getByRole('tooltip')).toHaveTextContent('Mở rộng thanh bên')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})

describe('<Badge /> and <NavCount />', () => {
  it('a full badge carries its tone, icon and text', () => {
    render(
      <Badge tone="warning" icon={Check}>
        Chờ
      </Badge>
    )
    const b = screen.getByText('Chờ').closest('span') as HTMLElement
    expect(b).toHaveClass('bg-warning-bg', 'text-warning-fg', 'border-warning-line')
    expect(b.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('a compact badge is an image with the required label', () => {
    render(<Badge tone="danger" icon={Check} compact label="Lỗi" />)
    const img = screen.getByRole('img', { name: 'Lỗi' })
    expect(img).toHaveAttribute('title', 'Lỗi')
  })

  it('NavCount caps at 999+ and, on the rail, at 99+', () => {
    const { rerender } = render(<NavCount value={1000} tone="warning" />)
    expect(screen.getByText('999+')).toBeInTheDocument()
    rerender(<NavCount value={999} tone="warning" />)
    expect(screen.getByText('999')).toBeInTheDocument()
    rerender(<NavCount value={100} tone="warning" rail />)
    expect(screen.getByText('99+')).toBeInTheDocument()
    rerender(<NavCount value={99} tone="warning" rail />)
    expect(screen.getByText('99')).toBeInTheDocument()
  })

  it('NavCount is hidden from assistive tech and the plain tone has no background', () => {
    render(<NavCount value={4} tone="plain" />)
    const n = screen.getByText('4')
    expect(n).toHaveAttribute('aria-hidden', 'true')
    expect(n).toHaveClass('text-ink-subtle')
    expect(n.className).not.toMatch(/bg-/)
  })
})
