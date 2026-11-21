// UC-001/AC-1: the one pending-count rule. Pending plus pending_decision, and the four handled
// statuses, of the selected project, from the single ['edits','all'] query.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import type { Edit } from '@/types/edit'

vi.mock('@/lib/ipc', () => ({ api: { listEdits: vi.fn() } }))
import { api } from '@/lib/ipc'
import { useNavCounts } from '../useNavCounts'

const listEdits = vi.mocked(api.listEdits)
const edit = (id: string, status: string, path = 'D:/code/demo/a.ts') => ({ id, status, path }) as unknown as Edit

function run(projectPath: string | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(() => useNavCounts(projectPath), {
    wrapper: ({ children }) => React.createElement(QueryClientProvider, { client: qc }, children)
  })
}

beforeEach(() => {
  listEdits.mockReset()
})

describe('useNavCounts — UC-001/AC-1', () => {
  it('UC-001/AC-1: counts pending and pending_decision as pending, and the four handled statuses as handled', async () => {
    listEdits.mockResolvedValue([
      edit('1', 'pending'),
      edit('2', 'pending_decision'),
      edit('3', 'accepted'),
      edit('4', 'rejected'),
      edit('5', 'rolled_back'),
      edit('6', 'auto_accepted')
    ])
    const { result } = run(null)
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.pending).toBe(2)
    expect(result.current.history).toBe(4)
    expect(result.current.pendingEdits.map((e) => e.id)).toEqual(['1', '2'])
    expect(result.current.historyEdits.map((e) => e.id)).toEqual(['3', '4', '5', '6'])
  })

  it('UC-001/AC-1: counts only the changes under the selected project path', async () => {
    listEdits.mockResolvedValue([
      edit('1', 'pending', 'D:/code/demo/a.ts'),
      edit('2', 'pending', 'D:/code/other/b.ts'),
      edit('3', 'accepted', 'D:/code/other/c.ts')
    ])
    const { result } = run('D:/code/demo')
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.pending).toBe(1)
    expect(result.current.history).toBe(0)
  })

  it('UC-001/AC-1: makes one list_edits call for both counts', async () => {
    listEdits.mockResolvedValue([edit('1', 'pending')])
    const { result } = run(null)
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(listEdits).toHaveBeenCalledTimes(1)
    expect(listEdits).toHaveBeenCalledWith({ limit: 5000 })
  })

  it('reads loading before the edits arrive', () => {
    listEdits.mockReturnValue(new Promise(() => {}))
    const { result } = run(null)
    expect(result.current.status).toBe('loading')
  })

  it('reads an error state, not a number, when the edits query fails', async () => {
    listEdits.mockRejectedValue(new Error('boom'))
    const { result } = run(null)
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.pending).toBeNull()
    expect(result.current.history).toBeNull()
  })
})
