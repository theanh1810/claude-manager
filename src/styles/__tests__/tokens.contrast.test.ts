import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { readTokens, tokenRatio, type Theme } from '@/test/contrast'

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const css = read('../globals.css')
const tailwindConfig = read('../../../tailwind.config.js')

const TEXT = 4.5
const NON_TEXT = 3
type Pair = [fg: string, bg: string, min: number]

const TONES = ['success', 'danger', 'warning', 'info'] as const
const SURFACES = ['surface-0', 'surface-1', 'surface-2', 'surface-3'] as const

// tokens.md §3: every pair the brief tabulates, with its threshold.
const PAIRS: Pair[] = [
  // 3.1 text on surfaces
  ...SURFACES.map((s): Pair => ['ink', s, TEXT]),
  ...SURFACES.map((s): Pair => ['ink-muted', s, TEXT]),
  ['ink-subtle', 'surface-0', TEXT],
  ['ink-subtle', 'surface-1', TEXT],
  ['ink-subtle', 'surface-2', TEXT],
  ['ink', 'accent-subtle', TEXT],
  ['ink-muted', 'accent-subtle', TEXT],
  ['ink-subtle', 'accent-subtle', TEXT],
  ['accent-fg', 'surface-0', TEXT],
  ['accent-fg', 'surface-1', TEXT],
  ['accent-fg', 'surface-2', TEXT],
  ['accent-fg', 'accent-subtle', TEXT],
  ['accent-fg', 'accent-subtle-hover', TEXT],
  ['ink', 'accent-subtle-hover', TEXT],
  // 3.2 text on solid buttons
  ['on-accent', 'accent', TEXT],
  ['on-accent', 'accent-hover', TEXT],
  ['on-accent', 'accent-active', TEXT],
  ['on-accent', 'success-solid', TEXT],
  ['on-accent', 'success-solid-hover', TEXT],
  ['on-accent', 'danger-solid', TEXT],
  ['on-accent', 'danger-solid-hover', TEXT],
  ['on-accent', 'warning-solid', TEXT],
  ['on-accent', 'warning-solid-hover', TEXT],
  // 3.3 tone text on tone background, surfaces and the selected row
  ...TONES.flatMap((t): Pair[] => [
    [`${t}-fg`, `${t}-bg`, TEXT],
    [`${t}-fg`, 'surface-0', TEXT],
    [`${t}-fg`, 'surface-1', TEXT],
    [`${t}-fg`, 'accent-subtle', TEXT]
  ]),
  ['danger-fg', 'danger-line', TEXT],
  // 3.4 non-text marks
  ...[...SURFACES.slice(0, 3), 'accent-subtle'].map((s): Pair => ['ring', s, NON_TEXT]),
  ...TONES.map((t): Pair => ['ring', `${t}-bg`, NON_TEXT]),
  ['line-control', 'surface-0', NON_TEXT],
  ['line-control', 'surface-1', NON_TEXT],
  ['line-control', 'surface-2', NON_TEXT],
  ['accent-fg', 'surface-0', NON_TEXT],
  ['accent-fg', 'surface-1', NON_TEXT],
  ['switch-knob', 'accent-fg', NON_TEXT],
  ['switch-knob', 'line-control', NON_TEXT],
  ['progress-fill', 'surface-3', NON_TEXT],
  ['progress-fill', 'surface-0', NON_TEXT],
  ['accent-fg', 'surface-3', NON_TEXT],
  ['tooltip-fg', 'tooltip-bg', TEXT],
  // 3.5 diff
  ['ink', 'diff-add-bg', TEXT],
  ['ink', 'diff-add-word', TEXT],
  ['ink', 'diff-del-bg', TEXT],
  ['ink', 'diff-del-word', TEXT],
  ['ink-muted', 'diff-add-gutter', TEXT],
  ['ink-muted', 'diff-del-gutter', TEXT],
  ['ink-subtle', 'surface-1', TEXT],
  ['ink-muted', 'surface-2', TEXT]
]

describe.each<Theme>(['light', 'dark'])('token contrast (%s theme)', (theme) => {
  const tokens = readTokens(css, theme)

  it.each(PAIRS)('%s on %s is at least %s:1', (fg, bg, min) => {
    expect(tokenRatio(tokens, fg, bg)).toBeGreaterThanOrEqual(min)
  })

  it('the accent track of an off switch stays distinguishable from the surface', () => {
    expect(tokenRatio(tokens, 'line-control', 'surface-0')).toBeGreaterThanOrEqual(NON_TEXT)
  })
})

describe('token blocks of globals.css', () => {
  const names = [
    ...SURFACES, 'line', 'line-strong', 'line-control', 'ink', 'ink-muted', 'ink-subtle', 'ink-disabled',
    'accent', 'accent-hover', 'accent-active', 'accent-fg', 'accent-subtle', 'accent-subtle-hover', 'on-accent', 'ring',
    ...TONES.flatMap((t) => [`${t}-bg`, `${t}-fg`, `${t}-line`]),
    ...['success', 'danger', 'warning'].flatMap((t) => [`${t}-solid`, `${t}-solid-hover`]),
    'progress-fill', 'tooltip-bg', 'tooltip-fg', 'switch-knob', 'scrim', 'scrim-a',
    'diff-add-bg', 'diff-add-gutter', 'diff-add-word', 'diff-del-bg', 'diff-del-gutter', 'diff-del-word'
  ]

  it('defines every semantic token of tokens.md section 2 in the light block', () => {
    const tokens = readTokens(css, 'light')
    expect(names.filter((n) => tokens[n] === undefined)).toEqual([])
  })

  it('overrides the surfaces, ink and accent in the dark block', () => {
    const light = readTokens(css, 'light')
    const dark = readTokens(css, 'dark')
    for (const n of ['surface-0', 'ink', 'accent-fg', 'danger-fg', 'diff-add-bg']) expect(dark[n]).not.toBe(light[n])
  })

  it('exposes every colour token as a Tailwind key and keeps no old palette key', () => {
    // `ring` is read by the focus rule in CSS, `scrim-a` only by the scrim colour: neither is a colour key.
    const colourNames = names.filter((n) => n !== 'scrim-a' && n !== 'ring')
    expect(colourNames.filter((n) => !tailwindConfig.includes(`c('${n}')`) && n !== 'scrim')).toEqual([])
    expect(tailwindConfig).not.toContain('brand:')
    expect(css).not.toMatch(/\.(?:btn|card|badge|list-item|skeleton)\b/)
  })

  it('gives every focusable element a 2px ring, on controls', () => {
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid rgb\(var\(--ring\)\)/)
    expect(css).not.toMatch(/\.btn\s*\{[^}]*focus:outline-none/)
  })

  it('keeps the root at 16px and sets 13px on the body only', () => {
    const root = /html,\s*body,\s*#root\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(root).not.toMatch(/font-size/)
    expect(/(?:^|\n)\s*body\s*\{([^}]*)\}/.exec(css)?.[1]).toMatch(/font-size:\s*13px/)
  })
})
