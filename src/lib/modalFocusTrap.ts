// Shared focus-trap options for every dialog in the app (SettingsModal,
// ConfirmDialog).
//
// Why this file exists: the trap was mocked to a passthrough in every
// test, because focus-trap refuses to activate when it cannot find a
// tabbable node — and jsdom reports zero size for everything, so its
// default `displayCheck: 'full'` rejects every element in the dialog.
// The result was a review gap carried since W3-T3e: "real trap behaviour
// needs Playwright". It does not; it needs the documented jsdom escape
// hatch.
//
// `displayCheck: 'none'` skips the visibility test entirely. That is
// WRONG for production — a hidden button would become a trap stop — so it
// is applied only under vitest (`import.meta.env.MODE === 'test'`).
// Browsers keep the default 'full'.
//
// Reference: https://github.com/focus-trap/tabbable#testing-in-jsdom

const IS_TEST = import.meta.env.MODE === 'test'

/**
 * Base options every modal passes to `<FocusTrap>`.
 *
 * - `escapeDeactivates: false` — each modal owns its own Esc listener so
 *   it can `stopPropagation` before closing.
 * - `clickOutsideDeactivates: false` — the backdrop's onClick handles it,
 *   which lets a dialog run its own guard before closing.
 * - `returnFocusOnDeactivate: true` — focus goes back to whatever opened
 *   the dialog, with no manual bookkeeping.
 */
// Intentionally un-annotated: the option type lives in `focus-trap`, a
// transitive dependency this package cannot import under pnpm's strict
// layout. The inferred literal type is checked at each `<FocusTrap>` call
// site against its own prop type, which is the check that matters.
export const modalFocusTrapOptions = {
  escapeDeactivates: false,
  clickOutsideDeactivates: false,
  returnFocusOnDeactivate: true,
  ...(IS_TEST ? { tabbableOptions: { displayCheck: 'none' as const } } : {}),
}
