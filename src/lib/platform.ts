/** A key of a shortcut: 'mod' is Cmd on macOS and Ctrl elsewhere, 'shift' is Shift; anything else is shown as given. */
export type ShortcutKey = string

/** Read on each call, so a test (or a webview that reports late) is never stuck with the first answer. */
function isMac(): boolean {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  return /mac|iphone|ipad/i.test(nav.userAgentData?.platform ?? nav.platform ?? '')
}

export function keyLabels(keys: ShortcutKey[]): string[] {
  const mac = isMac()
  return keys.map((k) => (k === 'mod' ? (mac ? '⌘' : 'Ctrl') : k === 'shift' ? (mac ? '⇧' : 'Shift') : k))
}

/** The text form: `⌘B` on macOS, `Ctrl+B` elsewhere. */
export function shortcutText(keys: ShortcutKey[]): string {
  return keyLabels(keys).join(isMac() ? '' : '+')
}
