// Regression guard for the crash the app-level smoke found: a component
// throwing during render used to unmount the whole React tree, leaving an
// empty document. The boundary must contain it.

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type MockInstance,
} from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import TabErrorBoundary from '../TabErrorBoundary'

function Boom(): JSX.Element {
  throw new Error('file_count is undefined')
}

describe('<TabErrorBoundary />', () => {
  let errorSpy: MockInstance<Parameters<typeof console.error>, void>

  beforeEach(() => {
    // React logs the caught error plus its own "The above error occurred"
    // notice; both are expected here.
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    errorSpy.mockRestore()
  })

  it('Tải lại màn này calls onReload before showing the screen again', () => {
    let broken = true
    function Maybe() {
      if (broken) throw new Error('bad cached data')
      return <p>screen back</p>
    }
    const onReload = vi.fn(() => {
      broken = false
    })
    render(
      <TabErrorBoundary label="Sessions" onReload={onReload}>
        <Maybe />
      </TabErrorBoundary>,
    )
    expect(onReload).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại màn này' }))
    expect(onReload).toHaveBeenCalledTimes(1)
    expect(screen.getByText('screen back')).toBeInTheDocument()
  })

  it('renders children when nothing throws', () => {
    render(
      <TabErrorBoundary label="config">
        <p>tab content</p>
      </TabErrorBoundary>,
    )
    expect(screen.getByText('tab content')).toBeInTheDocument()
    expect(screen.queryByTestId('tab-error')).toBeNull()
  })

  it('contains a throwing child and names the screen by its Vietnamese name with the error', () => {
    render(
      <TabErrorBoundary label="Dọn dẹp">
        <Boom />
      </TabErrorBoundary>,
    )

    const fallback = screen.getByTestId('tab-error')
    expect(fallback).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Màn “Dọn dẹp” gặp lỗi và đã dừng hiển thị')
    expect(fallback).toHaveTextContent('file_count is undefined')
    expect(fallback).toHaveTextContent(
      'Các màn khác vẫn dùng được. Chuyển sang màn khác rồi quay lại để thử tải lại.',
    )
    expect(fallback).not.toHaveTextContent(/Tab “/)
    // The surrounding document survives — this is the whole point.
    expect(document.body.innerHTML.length).toBeGreaterThan(50)
  })

  it('keeps the other screens usable', () => {
    render(
      <>
        <nav>
          <button>Plans</button>
        </nav>
        <TabErrorBoundary label="Dọn dẹp">
          <Boom />
        </TabErrorBoundary>
      </>,
    )
    expect(screen.getByRole('button', { name: 'Plans' })).toBeEnabled()
  })

  it('Tải lại màn này renders the screen again, and shows the card again if it still throws', () => {
    let broken = true
    function Flaky() {
      if (broken) throw new Error('still broken')
      return <p>screen back</p>
    }
    render(
      <TabErrorBoundary label="Plans">
        <Flaky />
      </TabErrorBoundary>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại màn này' }))
    expect(screen.getByRole('alert')).toHaveTextContent('still broken')
    broken = false
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại màn này' }))
    expect(screen.getByText('screen back')).toBeInTheDocument()
    expect(screen.queryByTestId('tab-error')).toBeNull()
  })

  it('logs the failure for debugging rather than swallowing it', () => {
    render(
      <TabErrorBoundary label="practice">
        <Boom />
      </TabErrorBoundary>,
    )
    expect(
      errorSpy.mock.calls.some((c) => String(c[0]).includes('practice')),
    ).toBe(true)
  })
})
