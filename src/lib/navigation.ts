import { Brain, ClipboardList, GitPullRequest, History, Trash2, Users, type LucideIcon } from 'lucide-react'

export type ScreenKey = 'edits' | 'history' | 'plans' | 'memory' | 'sessions' | 'cleanup'
export type NavGroupLabel = 'Review' | 'Dự án' | 'Máy'

export interface Screen {
  key: ScreenKey
  /** The visible h1 and the sidebar label. */
  title: string
  icon: LucideIcon
  group: NavGroupLabel
  /** The digit of Cmd or Ctrl plus 1 to 6. */
  shortcut: number
}

/** The one table of screens: the sidebar, the header and the number keys all read it. */
export const SCREENS: readonly Screen[] = [
  { key: 'edits', title: 'Chờ duyệt', icon: GitPullRequest, group: 'Review', shortcut: 1 },
  { key: 'history', title: 'Đã xử lý', icon: History, group: 'Review', shortcut: 2 },
  { key: 'plans', title: 'Plans', icon: ClipboardList, group: 'Dự án', shortcut: 3 },
  { key: 'memory', title: 'Memory & lỗi', icon: Brain, group: 'Dự án', shortcut: 4 },
  { key: 'sessions', title: 'Sessions', icon: Users, group: 'Máy', shortcut: 5 },
  { key: 'cleanup', title: 'Dọn dẹp', icon: Trash2, group: 'Máy', shortcut: 6 }
]

export const NAV_GROUPS: readonly { label: NavGroupLabel; screens: Screen[] }[] = (['Review', 'Dự án', 'Máy'] as const).map(
  (label) => ({ label, screens: SCREENS.filter((s) => s.group === label) })
)

export function screenForShortcut(n: number): Screen | undefined {
  return SCREENS.find((s) => s.shortcut === n)
}

export function screenByKey(key: ScreenKey): Screen {
  return SCREENS.find((s) => s.key === key) ?? SCREENS[0]
}
