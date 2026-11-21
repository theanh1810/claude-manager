import { create } from 'zustand'

export type ReviewTab = 'pending' | 'history'

interface ReviewFilterState {
  /** "chỉ thay đổi của Claude", kept separately for Pending and History. */
  claudeOnly: Record<ReviewTab, boolean>
  /** One session filter shared by both tabs, set from the Sessions screen. */
  sessionId: string | null
  setClaudeOnly: (tab: ReviewTab, on: boolean) => void
  setSessionId: (id: string | null) => void
}

export const useReviewFilterStore = create<ReviewFilterState>((set) => ({
  claudeOnly: { pending: false, history: false },
  sessionId: null,
  setClaudeOnly: (tab, on) => set((s) => ({ claudeOnly: { ...s.claudeOnly, [tab]: on } })),
  setSessionId: (sessionId) => set({ sessionId }),
}))
