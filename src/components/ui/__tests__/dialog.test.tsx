import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Dialog from '../Dialog'
import ConfirmDialog from '../ConfirmDialog'
import { ConfirmProvider, useConfirm } from '../ConfirmProvider'

type Options = Parameters<ReturnType<typeof useConfirm>>[0]
const NEUTRAL: Options = { title: 'Hoàn tác thay đổi đã chấp nhận?', description: 'File sẽ được đưa về nội dung trước.', confirmLabel: 'Hoàn tác' }
const DANGER: Options = { ...NEUTRAL, tone: 'danger', confirmLabel: 'Từ chối và hoàn tác' }

function Asker({ options, onResult }: { options: Options; onResult: (v: boolean) => void }) {
  const confirm = useConfirm()
  return <button onClick={async () => onResult(await confirm(options))}>Mở hộp</button>
}
const renderAsk = (options: Options) => {
  const onResult = vi.fn()
  render(
    <ConfirmProvider>
      <Asker options={options} onResult={onResult} />
    </ConfirmProvider>
  )
  return { onResult, user: userEvent.setup() }
}

describe('useConfirm', () => {
  it('returns true only from the confirm button', async () => {
    const { onResult, user } = renderAsk(NEUTRAL)
    await user.click(screen.getByRole('button', { name: 'Mở hộp' }))
    await user.click(await screen.findByRole('button', { name: 'Hoàn tác' }))
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('returns false from Hủy, from Esc and from the scrim, and nothing else runs', async () => {
    const { onResult, user } = renderAsk(NEUTRAL)
    const open = () => user.click(screen.getByRole('button', { name: 'Mở hộp' }))

    await open()
    await user.click(await screen.findByRole('button', { name: 'Hủy' }))
    await waitFor(() => expect(onResult).toHaveBeenNthCalledWith(1, false))

    await open()
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(onResult).toHaveBeenNthCalledWith(2, false))

    await open()
    fireEvent.click((await screen.findByRole('dialog')).parentElement as HTMLElement)
    await waitFor(() => expect(onResult).toHaveBeenNthCalledWith(3, false))
    expect(onResult).toHaveBeenCalledTimes(3)
    expect(onResult).not.toHaveBeenCalledWith(true)
  })

  it('a danger dialog focuses Hủy first and a neutral one focuses the confirm button', async () => {
    const danger = renderAsk(DANGER)
    await danger.user.click(screen.getByRole('button', { name: 'Mở hộp' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Hủy' })).toHaveFocus())
    await danger.user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('the neutral dialog opens on its confirm button', async () => {
    const { user } = renderAsk(NEUTRAL)
    await user.click(screen.getByRole('button', { name: 'Mở hộp' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Hoàn tác' })).toHaveFocus())
  })

  it('a second confirm waits for the first and keeps the order', async () => {
    const log: string[] = []
    function Two() {
      const confirm = useConfirm()
      return (
        <button
          onClick={() => {
            void confirm({ ...NEUTRAL, title: 'Hộp một' }).then((v) => log.push(`một:${v}`))
            void confirm({ ...NEUTRAL, title: 'Hộp hai' }).then((v) => log.push(`hai:${v}`))
          }}
        >
          Mở hai
        </button>
      )
    }
    const user = userEvent.setup()
    render(
      <ConfirmProvider>
        <Two />
      </ConfirmProvider>
    )
    await user.click(screen.getByRole('button', { name: 'Mở hai' }))
    expect(await screen.findByRole('dialog', { name: 'Hộp một' })).toBeInTheDocument()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Hoàn tác' }))
    expect(await screen.findByRole('dialog', { name: 'Hộp hai' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Hủy' }))
    await waitFor(() => expect(log).toEqual(['một:true', 'hai:false']))
  })

  it('carries aria-modal true and returns focus to the button that opened it', async () => {
    const { user } = renderAsk(NEUTRAL)
    const opener = screen.getByRole('button', { name: 'Mở hộp' })
    await user.click(opener)
    const dialog = await screen.findByRole('dialog', { name: NEUTRAL.title as string })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleDescription(NEUTRAL.description as string)
    await user.click(screen.getByRole('button', { name: 'Hủy' }))
    await waitFor(() => expect(opener).toHaveFocus())
  })

  it('throws a clear error outside a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Asker options={NEUTRAL} onResult={() => {}} />)).toThrow(/ConfirmProvider/)
    spy.mockRestore()
  })
})

describe('<Dialog />', () => {
  it('renders nothing while closed and closes from the X button', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { rerender } = render(
      <Dialog open={false} onClose={onClose} title="Cài đặt">
        nội dung
      </Dialog>
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    rerender(
      <Dialog open onClose={onClose} title="Cài đặt">
        nội dung
      </Dialog>
    )
    expect(screen.getByRole('dialog', { name: 'Cài đặt' })).toHaveTextContent('nội dung')
    await user.click(screen.getByRole('button', { name: 'Đóng' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a busy dialog ignores Esc, the scrim and the close button', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Dialog open busy onClose={onClose} title="Đang chuyển">
        x
      </Dialog>
    )
    await user.keyboard('{Escape}')
    fireEvent.click(screen.getByRole('dialog').parentElement as HTMLElement)
    await user.click(screen.getByRole('button', { name: 'Đóng' }))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Esc closes only the dialog on top', async () => {
    const user = userEvent.setup()
    const closeOuter = vi.fn()
    const closeInner = vi.fn()
    render(
      <>
        <Dialog open onClose={closeOuter} title="Ngoài">
          a
        </Dialog>
        <Dialog open onClose={closeInner} title="Trong">
          b
        </Dialog>
      </>
    )
    await user.keyboard('{Escape}')
    expect(closeInner).toHaveBeenCalledTimes(1)
    expect(closeOuter).not.toHaveBeenCalled()
  })

  it('shows a footer', () => {
    render(
      <Dialog open onClose={() => {}} title="T" footer={<button>Lưu</button>}>
        x
      </Dialog>
    )
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeInTheDocument()
  })
})

describe('<ConfirmDialog />', () => {
  it('stays open when onConfirm rejects, shows the error, and can be confirmed again', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined)
    function Host() {
      const [error, setError] = useState<string>()
      return (
        <ConfirmDialog
          {...NEUTRAL}
          error={error}
          onConfirm={async () => {
            try {
              await onConfirm()
            } catch (e) {
              setError('2 mục không chuyển được')
              throw e
            }
          }}
          onCancel={() => {}}
        />
      )
    }
    render(<Host />)
    await user.click(screen.getByRole('button', { name: 'Hoàn tác' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('2 mục không chuyển được')
    await user.click(screen.getByRole('button', { name: 'Hoàn tác' }))
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2))
  })

  it('a double click confirms once', () => {
    const onConfirm = vi.fn()
    render(<ConfirmDialog {...(NEUTRAL as Omit<Parameters<typeof ConfirmDialog>[0], 'onConfirm' | 'onCancel'>)} onConfirm={onConfirm} onCancel={() => {}} />)
    const b = screen.getByRole('button', { name: 'Hoàn tác' })
    fireEvent.click(b)
    fireEvent.click(b)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('Hủy and Esc call onCancel and never onConfirm; busy puts the confirm button in loading', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    const props = NEUTRAL as Omit<Parameters<typeof ConfirmDialog>[0], 'onConfirm' | 'onCancel'>
    const { rerender } = render(<ConfirmDialog {...props} onConfirm={onConfirm} onCancel={onCancel} />)
    await user.click(screen.getByRole('button', { name: 'Hủy' }))
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(2)
    expect(onConfirm).not.toHaveBeenCalled()
    rerender(<ConfirmDialog {...props} busy onConfirm={onConfirm} onCancel={onCancel} />)
    expect(screen.getByRole('button', { name: 'Hoàn tác' })).toHaveAttribute('aria-busy', 'true')
  })

  it('lists details under the description', () => {
    render(<ConfirmDialog {...(NEUTRAL as Omit<Parameters<typeof ConfirmDialog>[0], 'onConfirm' | 'onCancel'>)} details={<ul><li>skills.zip</li></ul>} onConfirm={() => {}} onCancel={() => {}} />)
    expect(screen.getByText('skills.zip')).toBeInTheDocument()
  })
})
