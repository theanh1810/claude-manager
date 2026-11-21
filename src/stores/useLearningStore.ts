import { create } from 'zustand'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'

// Learning mode flag (W6-T6a).
//
// When on, agents append a "## Học được gì" section to their handoffs
// (global AGENTS.md §16.3). The renderer owns this flag: it is a UI
// preference, not server state, so it lives in localStorage rather than
// the SQLite settings table. The Rust side only broadcasts the change
// (`settings_learning_toggle` → `learning-changed`) for other listeners.
//
// Why Zustand + persist rather than a plain useState in App:
//   the Sidebar renders the button, the keyboard shortcut fires from a hook
//   mounted in App, and future surfaces (agent handoff renderers) will
//   read it too. A store keeps those three from prop-drilling through the
//   whole tree, and `persist` handles the reload case without an effect.

export interface LearningState {
  enabled: boolean
  toggle: () => void
  setEnabled: (enabled: boolean) => void
}

/** localStorage key. Namespaced `cm.` like `cm.activeProject` (App.tsx:22). */
export const LEARNING_STORAGE_KEY = 'cm.learning'

/**
 * localStorage resolved PER CALL and guarded, rather than captured once at
 * module load. Two reasons:
 *   - Robustness: private-mode / quota / disabled-storage failures degrade
 *     to in-memory instead of throwing (same posture as App.tsx:27-31).
 *   - Testability: under Node 25 the experimental web-storage global
 *     shadows jsdom's and has no `setItem`, so tests must stub it — a
 *     captured reference would still point at the broken one.
 */
const safeStorage: StateStorage = {
  getItem: (name) => {
    try {
      return globalThis.localStorage?.getItem?.(name) ?? null
    } catch {
      return null
    }
  },
  setItem: (name, value) => {
    try {
      globalThis.localStorage?.setItem?.(name, value)
    } catch {
      /* persistence degrades to in-memory for this session */
    }
  },
  removeItem: (name) => {
    try {
      globalThis.localStorage?.removeItem?.(name)
    } catch {
      /* nothing to clean up if storage is unavailable */
    }
  },
}

/**
 * Store factory. The app uses the singleton below; tests use this to build
 * a second instance, which is how "reload" is simulated honestly — a fresh
 * store reads `localStorage` during creation, exactly like a page load.
 * (Re-importing the module would return the cached singleton and prove
 * nothing, and `persist.rehydrate()` does not re-apply state on an
 * already-hydrated store.)
 */
export const createLearningStore = () =>
  create<LearningState>()(
    persist(
      (set) => ({
        enabled: false,
        toggle: () => set((s) => ({ enabled: !s.enabled })),
        setEnabled: (enabled) => set({ enabled }),
      }),
      {
        name: LEARNING_STORAGE_KEY,
        storage: createJSONStorage(() => safeStorage),
        // Only the flag is persisted; the actions are recreated on load.
        partialize: (s) => ({ enabled: s.enabled }) as LearningState,
      },
    ),
  )

export const useLearningStore = createLearningStore()
