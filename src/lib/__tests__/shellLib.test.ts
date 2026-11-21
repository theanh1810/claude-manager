// Shell tables: the one navigation table, the project colour pick and the platform key labels.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NAV_GROUPS, SCREENS, screenForShortcut } from '../navigation'
import { PROJECT_COLORS, pickProjectColor } from '../projectColors'
import { keyLabels, shortcutText } from '../platform'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('navigation table', () => {
  it('UC-001/AC-1: lists the six screens once, in the order Chờ duyệt to Dọn dẹp, with keys 1 to 6', () => {
    expect(SCREENS.map((s) => [s.shortcut, s.key, s.title])).toEqual([
      [1, 'edits', 'Chờ duyệt'],
      [2, 'history', 'Đã xử lý'],
      [3, 'plans', 'Plans'],
      [4, 'memory', 'Memory & lỗi'],
      [5, 'sessions', 'Sessions'],
      [6, 'cleanup', 'Dọn dẹp']
    ])
  })

  it('groups the screens as Review, Dự án and Máy without repeating one', () => {
    expect(NAV_GROUPS.map((g) => [g.label, g.screens.map((s) => s.key)])).toEqual([
      ['Review', ['edits', 'history']],
      ['Dự án', ['plans', 'memory']],
      ['Máy', ['sessions', 'cleanup']]
    ])
  })

  it('finds a screen by its shortcut number and none outside 1 to 6', () => {
    expect(screenForShortcut(4)?.key).toBe('memory')
    expect(screenForShortcut(0)).toBeUndefined()
    expect(screenForShortcut(7)).toBeUndefined()
  })
})

describe('project colours', () => {
  it('picks one colour of the list, by the random source it is given', () => {
    expect(pickProjectColor(() => 0)).toBe(PROJECT_COLORS[0])
    expect(pickProjectColor(() => 0.999)).toBe(PROJECT_COLORS[PROJECT_COLORS.length - 1])
    expect(PROJECT_COLORS).toContain(pickProjectColor())
  })
})

describe('platform keys', () => {
  it('shows Cmd and Shift symbols on macOS', () => {
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel')
    expect(keyLabels(['mod', 'shift', 'L'])).toEqual(['⌘', '⇧', 'L'])
    expect(shortcutText(['mod', 'B'])).toBe('⌘B')
  })

  it('shows Ctrl and Shift words elsewhere', () => {
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('Win32')
    expect(keyLabels(['mod', 'shift', 'L'])).toEqual(['Ctrl', 'Shift', 'L'])
    expect(shortcutText(['mod', ','])).toBe('Ctrl+,')
  })
})
