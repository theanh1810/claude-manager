import { useEffect, useLayoutEffect, useRef } from 'react'

interface Options {
  /** Each handler returns true when it handled the key; only then is the key's default prevented. */
  onAccept?: () => boolean
  onReject?: () => boolean
  onSettings?: () => boolean
  onPause?: () => boolean
  /** Ctrl+Shift+L (Cmd+Shift+L on macOS) — learning mode (W6-T6a). */
  onLearning?: () => boolean
  /** Cmd or Ctrl plus 1 to 6: open that screen. */
  onScreen?: (n: number) => boolean
  /** Cmd or Ctrl plus B: collapse or open the sidebar. */
  onSidebar?: () => boolean
  /** ?: open the shortcut sheet. */
  onHelp?: () => boolean
  /** /: focus the search field of the screen. */
  onSearch?: () => boolean
  /** j and k: the next and the previous row of the primary list. */
  onNext?: () => boolean
  onPrev?: () => boolean
  enabled?: boolean
  /** While true, A, R, j and k do nothing and keep their default: a decision is still settling. */
  locked?: boolean
}

/**
 * One keydown listener for the life of the component. It reads the latest handlers from a ref,
 * so a re-render never re-binds it and a handler never goes stale.
 */
export function useKeyboardShortcuts(opts: Options) {
  const latest = useRef(opts)
  useLayoutEffect(() => {
    latest.current = opts
  })

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const o = latest.current
      if (o.enabled === false) return
      // A focused widget (the project menu's typeahead, for one) owns a key it already prevented.
      if (e.defaultPrevented) return
      const target = e.target as HTMLElement
      const role = target.getAttribute?.('role')
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable ||
        role === 'textbox' ||
        role === 'combobox'
      ) {
        return
      }
      // Any open dialog swallows global shortcuts. Detected from the DOM
      // rather than plumbed through props: modals live deep in feature
      // subtrees (SettingsModal, ConfirmDialog) and each new
      // one would otherwise have to remember to disable them. `aria-modal`
      // is already required on every dialog for a11y, so this costs
      // nothing and cannot be forgotten.
      if (document.querySelector('[aria-modal="true"]')) return
      const run = (fn: (() => boolean) | undefined) => {
        if (fn?.()) e.preventDefault()
      }
      const meta = e.metaKey || e.ctrlKey
      if (meta) {
        // Shift+L first: the modifier-heaviest binding leads the chain. `e.key` is 'L'
        // when shift is held, so both cases are checked — some layouts report the unshifted char.
        if (e.shiftKey && (e.key === 'L' || e.key === 'l')) run(o.onLearning)
        else if (e.key === ',') run(o.onSettings)
        else if (e.key === '.') run(o.onPause)
        else if (e.key === 'b' || e.key === 'B') run(o.onSidebar)
        else if (/^[1-6]$/.test(e.key)) run(() => o.onScreen?.(Number(e.key)) ?? false)
        return
      }
      switch (e.key) {
        case '?':
          run(o.onHelp)
          break
        case '/':
          run(o.onSearch)
          break
        case 'a':
        case 'A':
          if (!o.locked) run(o.onAccept)
          break
        case 'r':
        case 'R':
          if (!o.locked) run(o.onReject)
          break
        case 'j':
        case 'J':
          if (!o.locked) run(o.onNext)
          break
        case 'k':
        case 'K':
          if (!o.locked) run(o.onPrev)
          break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
}
