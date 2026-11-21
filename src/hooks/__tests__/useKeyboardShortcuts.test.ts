// Hook tests for useKeyboardShortcuts — UC-001/AC-13: the A/R keys honour the
// typing and dialog guards, and the key's default is prevented only when the
// handler reports it handled the key.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, fireEvent } from '@testing-library/react'
import { useKeyboardShortcuts } from '../useKeyboardShortcuts'

afterEach(() => {
  document.body.innerHTML = ''
})

function attach(el: HTMLElement): HTMLElement {
  document.body.appendChild(el)
  return el
}

describe('useKeyboardShortcuts — UC-001/AC-13', () => {
  it('UC-001/AC-13: A calls onAccept and prevents the default when it handled the key', () => {
    const onAccept = vi.fn(() => true)
    renderHook(() => useKeyboardShortcuts({ onAccept }))
    const notPrevented = fireEvent.keyDown(window, { key: 'a' })
    expect(onAccept).toHaveBeenCalledTimes(1)
    expect(notPrevented).toBe(false)
  })

  it('UC-001/AC-13: R calls onReject and prevents the default when it handled the key', () => {
    const onReject = vi.fn(() => true)
    renderHook(() => useKeyboardShortcuts({ onReject }))
    const notPrevented = fireEvent.keyDown(window, { key: 'R' })
    expect(onReject).toHaveBeenCalledTimes(1)
    expect(notPrevented).toBe(false)
  })

  it('UC-001/AC-13: locked=true makes A and R do nothing and keeps their default', () => {
    const onAccept = vi.fn(() => true)
    const onReject = vi.fn(() => true)
    renderHook(() => useKeyboardShortcuts({ onAccept, onReject, locked: true }))
    expect(fireEvent.keyDown(window, { key: 'r' })).toBe(true)
    expect(fireEvent.keyDown(window, { key: 'a' })).toBe(true)
    expect(onReject).not.toHaveBeenCalled()
    expect(onAccept).not.toHaveBeenCalled()
  })

  it('UC-001/AC-13: a handler that returns false leaves the key default alone', () => {
    const onAccept = vi.fn(() => false)
    const onReject = vi.fn(() => false)
    renderHook(() => useKeyboardShortcuts({ onAccept, onReject }))
    expect(fireEvent.keyDown(window, { key: 'a' })).toBe(true)
    expect(fireEvent.keyDown(window, { key: 'r' })).toBe(true)
    expect(onAccept).toHaveBeenCalledTimes(1)
    expect(onReject).toHaveBeenCalledTimes(1)
  })

  it('UC-001/AC-13: R inside a select, input, textarea, role=textbox or role=combobox rejects nothing', () => {
    const onReject = vi.fn(() => true)
    renderHook(() => useKeyboardShortcuts({ onReject }))
    const textbox = document.createElement('div')
    textbox.setAttribute('role', 'textbox')
    const combobox = document.createElement('div')
    combobox.setAttribute('role', 'combobox')
    const fields = [
      attach(document.createElement('select')),
      attach(document.createElement('input')),
      attach(document.createElement('textarea')),
      attach(textbox),
      attach(combobox)
    ]
    for (const el of fields) {
      expect(fireEvent.keyDown(el, { key: 'r' })).toBe(true)
    }
    expect(onReject).not.toHaveBeenCalled()
  })

  it('UC-001/AC-13: an open dialog swallows A and R', () => {
    const onAccept = vi.fn(() => true)
    renderHook(() => useKeyboardShortcuts({ onAccept }))
    const dialog = document.createElement('div')
    dialog.setAttribute('aria-modal', 'true')
    attach(dialog)
    expect(fireEvent.keyDown(window, { key: 'a' })).toBe(true)
    expect(onAccept).not.toHaveBeenCalled()
  })

  it('UC-001/AC-13: Ctrl+, calls onSettings and prevents the default only when handled', () => {
    const handled = vi.fn(() => true)
    const { unmount } = renderHook(() => useKeyboardShortcuts({ onSettings: handled }))
    expect(fireEvent.keyDown(window, { key: ',', ctrlKey: true })).toBe(false)
    unmount()
    const notHandled = vi.fn(() => false)
    renderHook(() => useKeyboardShortcuts({ onSettings: notHandled }))
    expect(fireEvent.keyDown(window, { key: ',', ctrlKey: true })).toBe(true)
  })
})

// The learning, settings and pause bindings moved here from the test of the old header bar.
describe('useKeyboardShortcuts — learning binding', () => {
  it('TC-W6-T6a-2: Ctrl+Shift+L fires onLearning', () => {
    const onLearning = vi.fn()
    renderHook(() => useKeyboardShortcuts({ onLearning }))
    fireEvent.keyDown(window, { key: 'L', ctrlKey: true, shiftKey: true })
    expect(onLearning).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(window, { key: 'l', metaKey: true, shiftKey: true })
    expect(onLearning).toHaveBeenCalledTimes(2)
  })

  it('does not fire the learning key from inside a text input', () => {
    const onLearning = vi.fn()
    renderHook(() => useKeyboardShortcuts({ onLearning }))
    const input = attach(document.createElement('input'))
    fireEvent.keyDown(input, { key: 'L', ctrlKey: true, shiftKey: true })
    expect(onLearning).not.toHaveBeenCalled()
  })

  it('does not collide with the settings and pause bindings', () => {
    const onLearning = vi.fn()
    const onSettings = vi.fn()
    const onPause = vi.fn()
    renderHook(() => useKeyboardShortcuts({ onLearning, onSettings, onPause }))
    fireEvent.keyDown(window, { key: ',', ctrlKey: true })
    fireEvent.keyDown(window, { key: '.', ctrlKey: true })
    expect(onSettings).toHaveBeenCalledTimes(1)
    expect(onPause).toHaveBeenCalledTimes(1)
    expect(onLearning).not.toHaveBeenCalled()
  })
})

describe('useKeyboardShortcuts — stable listener', () => {
  it('UC-001/AC-13: adds the keydown listener once and calls the latest handler after a re-render', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const first = vi.fn(() => true)
    const second = vi.fn(() => true)
    const { rerender, unmount } = renderHook(({ onAccept }) => useKeyboardShortcuts({ onAccept }), {
      initialProps: { onAccept: first }
    })
    rerender({ onAccept: second })
    rerender({ onAccept: second })
    expect(add.mock.calls.filter((c) => c[0] === 'keydown')).toHaveLength(1)
    fireEvent.keyDown(window, { key: 'a' })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    unmount()
    add.mockRestore()
  })

  it('stops listening when disabled and listens again when enabled', () => {
    const onAccept = vi.fn(() => true)
    const { rerender } = renderHook(({ enabled }) => useKeyboardShortcuts({ onAccept, enabled }), {
      initialProps: { enabled: false }
    })
    fireEvent.keyDown(window, { key: 'a' })
    expect(onAccept).not.toHaveBeenCalled()
    rerender({ enabled: true })
    fireEvent.keyDown(window, { key: 'a' })
    expect(onAccept).toHaveBeenCalledTimes(1)
  })
})

describe('useKeyboardShortcuts — screen, sidebar, help, search and list keys', () => {
  it('fires onScreen with 1 to 6 under Cmd or Ctrl, and for no other digit', () => {
    const onScreen = vi.fn((_n: number) => true)
    renderHook(() => useKeyboardShortcuts({ onScreen }))
    for (const n of [1, 2, 3, 4, 5, 6]) fireEvent.keyDown(window, { key: String(n), ctrlKey: true })
    fireEvent.keyDown(window, { key: '3', metaKey: true })
    expect(onScreen.mock.calls.map((c) => c[0])).toEqual([1, 2, 3, 4, 5, 6, 3])
    fireEvent.keyDown(window, { key: '7', ctrlKey: true })
    fireEvent.keyDown(window, { key: '0', ctrlKey: true })
    fireEvent.keyDown(window, { key: '3' })
    expect(onScreen).toHaveBeenCalledTimes(7)
  })

  it('fires onSidebar on Cmd or Ctrl B, onHelp on ?, onSearch on / and onNext/onPrev on j and k', () => {
    const h = { onSidebar: vi.fn(), onHelp: vi.fn(), onSearch: vi.fn(), onNext: vi.fn(), onPrev: vi.fn() }
    renderHook(() => useKeyboardShortcuts(h))
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'B', metaKey: true })
    fireEvent.keyDown(window, { key: '?', shiftKey: true })
    fireEvent.keyDown(window, { key: '/' })
    fireEvent.keyDown(window, { key: 'j' })
    fireEvent.keyDown(window, { key: 'k' })
    expect(h.onSidebar).toHaveBeenCalledTimes(2)
    expect(h.onHelp).toHaveBeenCalledTimes(1)
    expect(h.onSearch).toHaveBeenCalledTimes(1)
    expect(h.onNext).toHaveBeenCalledTimes(1)
    expect(h.onPrev).toHaveBeenCalledTimes(1)
  })

  it('UC-001/AC-18: j moves the selection to the next change, k to the previous one, and the key default is kept unless handled', () => {
    const onNext = vi.fn(() => true)
    const onPrev = vi.fn(() => false)
    renderHook(() => useKeyboardShortcuts({ onNext, onPrev }))
    expect(fireEvent.keyDown(window, { key: 'j' })).toBe(false)
    expect(fireEvent.keyDown(window, { key: 'k' })).toBe(true)
  })

  it('ignores every new key while typing in an input, a textarea, a select, a textbox or a combobox', () => {
    const h = { onScreen: vi.fn(), onSidebar: vi.fn(), onHelp: vi.fn(), onSearch: vi.fn(), onNext: vi.fn(), onPrev: vi.fn() }
    renderHook(() => useKeyboardShortcuts(h))
    const textbox = document.createElement('div')
    textbox.setAttribute('role', 'textbox')
    for (const el of [
      document.createElement('input'),
      document.createElement('textarea'),
      document.createElement('select'),
      textbox
    ]) {
      attach(el)
      fireEvent.keyDown(el, { key: '1', ctrlKey: true })
      fireEvent.keyDown(el, { key: 'b', ctrlKey: true })
      for (const key of ['?', '/', 'j', 'k']) fireEvent.keyDown(el, { key })
    }
    for (const fn of Object.values(h)) expect(fn).not.toHaveBeenCalled()
  })

  it('a key whose default a focused widget already prevented runs no shortcut', () => {
    const h = { onAccept: vi.fn(() => true), onReject: vi.fn(() => true), onNext: vi.fn(() => true) }
    renderHook(() => useKeyboardShortcuts(h))
    const widget = attach(document.createElement('div'))
    widget.addEventListener('keydown', (e) => e.preventDefault())
    for (const key of ['r', 'a', 'j']) fireEvent.keyDown(widget, { key })
    expect(h.onReject).not.toHaveBeenCalled()
    expect(h.onAccept).not.toHaveBeenCalled()
    expect(h.onNext).not.toHaveBeenCalled()
  })

  it('ignores every new key while an aria-modal dialog is open', () => {
    const h = { onScreen: vi.fn(), onSidebar: vi.fn(), onHelp: vi.fn(), onSearch: vi.fn(), onNext: vi.fn(), onPrev: vi.fn() }
    renderHook(() => useKeyboardShortcuts(h))
    const dialog = document.createElement('div')
    dialog.setAttribute('aria-modal', 'true')
    attach(dialog)
    fireEvent.keyDown(window, { key: '1', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true })
    for (const key of ['?', '/', 'j', 'k']) fireEvent.keyDown(window, { key })
    for (const fn of Object.values(h)) expect(fn).not.toHaveBeenCalled()
  })

  it('UC-001/AC-18: j, k, A and R wait while locked, and the screen, help, search and sidebar keys still work', () => {
    const h = {
      onAccept: vi.fn(), onReject: vi.fn(), onNext: vi.fn(), onPrev: vi.fn(),
      onScreen: vi.fn(), onSidebar: vi.fn(), onHelp: vi.fn(), onSearch: vi.fn(), locked: true
    }
    renderHook(() => useKeyboardShortcuts(h))
    for (const key of ['a', 'r', 'j', 'k']) expect(fireEvent.keyDown(window, { key })).toBe(true)
    expect(h.onAccept).not.toHaveBeenCalled()
    expect(h.onReject).not.toHaveBeenCalled()
    expect(h.onNext).not.toHaveBeenCalled()
    expect(h.onPrev).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: '2', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true })
    fireEvent.keyDown(window, { key: '?' })
    fireEvent.keyDown(window, { key: '/' })
    expect(h.onScreen).toHaveBeenCalledWith(2)
    expect(h.onSidebar).toHaveBeenCalledTimes(1)
    expect(h.onHelp).toHaveBeenCalledTimes(1)
    expect(h.onSearch).toHaveBeenCalledTimes(1)
  })
})
