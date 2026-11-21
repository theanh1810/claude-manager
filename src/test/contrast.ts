// WCAG 2.x contrast helpers and a reader for the theme variables of
// src/styles/globals.css. Shared by the token contrast test and, later, by the
// Plans contrast helper (design D13).

export type Theme = 'light' | 'dark'
export type Rgb = [number, number, number]
export type Tokens = Record<string, string>

const DARK_QUERY = '@media (prefers-color-scheme: dark)'

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Splits the sheet into its light part and the bodies of the dark media blocks. */
function splitDark(css: string): { light: string; dark: string } {
  let light = ''
  let dark = ''
  let from = 0
  for (;;) {
    const at = css.indexOf(DARK_QUERY, from)
    if (at < 0) break
    const open = css.indexOf('{', at)
    let depth = 1
    let i = open + 1
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth += 1
      else if (css[i] === '}') depth -= 1
      i += 1
    }
    light += css.slice(from, at)
    dark += css.slice(open + 1, i - 1)
    from = i
  }
  return { light: light + css.slice(from), dark }
}

function rootVars(css: string): Tokens {
  const vars: Tokens = {}
  for (const block of css.matchAll(/:root\s*\{([^}]*)\}/g)) {
    for (const d of block[1].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) vars[d[1]] = d[2].trim()
  }
  return vars
}

/** Every `--name` of the `:root` blocks; the dark theme is the light one overridden by the dark media block. */
export function readTokens(css: string, theme: Theme): Tokens {
  const { light, dark } = splitDark(stripComments(css))
  const base = rootVars(light)
  return theme === 'dark' ? { ...base, ...rootVars(dark) } : base
}

/** A token written as three space-separated channels, e.g. `79 70 229`. */
function rgbOf(tokens: Tokens, name: string): Rgb {
  const raw = tokens[name]
  if (raw === undefined) throw new Error(`token --${name} is not defined`)
  const parts = raw.split(/\s+/).map(Number)
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`token --${name} is not an RGB triplet: ${raw}`)
  }
  return parts as Rgb
}

function luminance([r, g, b]: Rgb): number {
  const f = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

export function tokenRatio(tokens: Tokens, fg: string, bg: string): number {
  return contrastRatio(rgbOf(tokens, fg), rgbOf(tokens, bg))
}
