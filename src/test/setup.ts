// Vitest setup: runs once before any test file.
// - Loads @testing-library/jest-dom matchers (toBeInTheDocument, toHaveClass…)
// - Mocks the Tauri IPC bridge so components that import { invoke } from
//   '@tauri-apps/api/core' do not throw "tauri internal not present" in jsdom.

import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

// React 18 checks this flag before treating updates as act-wrapped. Without
// it, any state update React flushes outside a testing-library call (a lazy
// chunk resolving, a Suspense boundary committing) logs
// "The current testing environment is not configured to support act(...)".
// Those warnings are noise in every suite and would drown a real error in
// the app-level smoke, which asserts console.error is silent.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true

// Default: a vi.fn() that returns undefined. Individual tests override per-call
// via (invoke as any).mockResolvedValueOnce(...) when they need real return
// shapes.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

// Tauri event bus is used by App.tsx — stub it so component renders don't
// blow up trying to subscribe to a non-existent event stream.
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {})
}))

// jsdom does not implement window.matchMedia (used by EditDetailPanel for
// prefers-color-scheme detection). Provide a never-matching stub so render
// proceeds without TypeError.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  }))
}
