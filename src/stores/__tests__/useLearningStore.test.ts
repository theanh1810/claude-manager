// Tests for the learning-mode store (W6-T6a).
//
// Contract (docs/plan/manager-v2/plan.yaml:1471-1476):
//   TC-1  Toggle persists across a reload (localStorage restored).
//
// localStorage is stubbed with an in-memory Storage: Node 25's
// experimental web-storage global shadows jsdom's and has no
// getItem/setItem.
//
// "Reload" is simulated by building a SECOND store from the exported
// factory: a fresh store reads localStorage during creation, exactly like
// a page load. Re-importing the module would return the cached singleton,
// and `persist.rehydrate()` does not re-apply state to a store that has
// already hydrated (verified against zustand 4.5 — it resolves without
// touching `enabled`).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

function makeStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  }
}

// Stub before importing the store: `persist` reads storage at module init.
const storage = makeStorage()
vi.stubGlobal('localStorage', storage)

const { useLearningStore, createLearningStore, LEARNING_STORAGE_KEY } =
  await import('../useLearningStore')

describe('useLearningStore', () => {
  beforeEach(() => {
    useLearningStore.setState({ enabled: false })
    storage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.stubGlobal('localStorage', storage)
  })

  it('starts disabled and toggles', () => {
    expect(useLearningStore.getState().enabled).toBe(false)
    useLearningStore.getState().toggle()
    expect(useLearningStore.getState().enabled).toBe(true)
    useLearningStore.getState().toggle()
    expect(useLearningStore.getState().enabled).toBe(false)
  })

  it('TC-W6-T6a-1: the flag survives a reload via localStorage', () => {
    useLearningStore.getState().toggle()
    expect(useLearningStore.getState().enabled).toBe(true)

    const raw = storage.getItem(LEARNING_STORAGE_KEY)
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw as string).state).toEqual({ enabled: true })

    // Reload: a brand-new store hydrates from the same storage.
    const reloaded = createLearningStore()
    expect(reloaded.getState().enabled).toBe(true)
  })

  it('a fresh store with empty storage starts disabled', () => {
    storage.clear()
    expect(createLearningStore().getState().enabled).toBe(false)
  })

  it('setEnabled writes an explicit value', () => {
    useLearningStore.getState().setEnabled(true)
    expect(useLearningStore.getState().enabled).toBe(true)
    useLearningStore.getState().setEnabled(true)
    expect(useLearningStore.getState().enabled).toBe(true)
  })
})
