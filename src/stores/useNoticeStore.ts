import type { ReactNode } from 'react'
import { create } from 'zustand'

export type NoticeTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral'

const MAX_NOTICES = 3

export interface Notice {
  id: string
  tone: NoticeTone
  children: ReactNode
  /** Only for a clean success; a failure stays until the user hides it. */
  autoHideMs?: number
  actions?: ReactNode
}

type NoticeInput = Omit<Notice, 'id'> & { id?: string }

interface NoticeState {
  notices: Notice[]
  /** The same `id` replaces the earlier notice, so a repeated action shows its latest result only. */
  notify: (notice: NoticeInput) => string
  dismiss: (id: string) => void
  clear: () => void
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()
let sequence = 0

function cancelTimer(id: string) {
  clearTimeout(timers.get(id))
  timers.delete(id)
}

export const useNoticeStore = create<NoticeState>((set, get) => ({
  notices: [],
  notify: (input) => {
    const id = input.id ?? `notice-${++sequence}`
    cancelTimer(id)
    const next = [...get().notices.filter((n) => n.id !== id), { ...input, id }]
    const kept = next.slice(-MAX_NOTICES)
    for (const dropped of next.slice(0, next.length - kept.length)) cancelTimer(dropped.id)
    set({ notices: kept })
    if (input.autoHideMs !== undefined) timers.set(id, setTimeout(() => get().dismiss(id), input.autoHideMs))
    return id
  },
  dismiss: (id) => {
    cancelTimer(id)
    set((s) => ({ notices: s.notices.filter((n) => n.id !== id) }))
  },
  clear: () => {
    for (const id of [...timers.keys()]) cancelTimer(id)
    set({ notices: [] })
  }
}))
