// Component tests for DiffView: the wrapper around react-diff-viewer-continued. The diff algorithm
// is the library's; these cover what the wrapper decides (columns, themes, empty input).
//
// react-diff-viewer internally schedules state updates after mount, so each render is wrapped in
// `act(async)` to flush them.

import { describe, it, expect } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import DiffView from './DiffView'

describe('<DiffView />', () => {
  it('renders both columns titled Trước and Sau', async () => {
    await act(async () => {
      render(<DiffView before={'foo\nbar'} after={'foo\nbaz'} />)
    })
    expect(screen.getByText('Trước')).toBeInTheDocument()
    expect(screen.getByText('Sau')).toBeInTheDocument()
  })

  it('renders without throwing on empty before content (new-file case)', async () => {
    await act(async () => {
      render(<DiffView before={''} after={'newly created'} />)
    })
    expect(screen.getByText('Sau')).toBeInTheDocument()
  })

  it('renders without throwing when before == after (no-op edit)', async () => {
    await act(async () => {
      render(<DiffView before={'same'} after={'same'} />)
    })
    expect(screen.getByText('Trước')).toBeInTheDocument()
  })
})
