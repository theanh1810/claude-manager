// Contrast helper of the Plans tests (design D13). A colour class is resolved to the RGB it paints:
// a token class (`text-ink-muted`, `bg-success-bg`, `bg-accent-subtle`) reads its `--variable` from
// src/styles/globals.css for the theme asked, so no pane or hover colour is copied by hand here.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readTokens, contrastRatio, type Rgb, type Theme, type Tokens } from '@/test/contrast'

export type { Theme }
export const THEMES: Theme[] = ['light', 'dark']

/** An RGB with the opacity the class asked (`bg-x/40` is 0.4). */
export interface Colour {
  rgb: Rgb
  alpha: number
}

const css = readFileSync(resolve(process.cwd(), 'src/styles/globals.css'), 'utf8')
const TOKENS: Record<Theme, Tokens> = { light: readTokens(css, 'light'), dark: readTokens(css, 'dark') }

// tailwind.config.js names that differ from their variable.
const ALIAS: Record<string, string> = { 'accent-on': 'on-accent', progress: 'progress-fill', knob: 'switch-knob' }

const WHITE: Colour = { rgb: [255, 255, 255], alpha: 1 }

function triplet(raw: string): Rgb {
  return raw.split(/\s+/).map(Number) as Rgb
}

function lookup(name: string, theme: Theme): Rgb | null {
  const raw = TOKENS[theme][ALIAS[name] ?? name]
  if (raw !== undefined) return /^\d+ \d+ \d+$/.test(raw) ? triplet(raw) : null
  return null
}

/** A surface token (`surface-0`, `surface-1`, `accent-subtle`...) in one theme. */
export function surface(name: string, theme: Theme): Colour {
  const rgb = lookup(name, theme)
  if (!rgb) throw new Error(`token --${name} is not an RGB triplet`)
  return { rgb, alpha: 1 }
}

/** The surfaces a mark may sit on: a pane, a raised pane, and the selected row. */
export const SURFACES = ['surface-0', 'surface-1', 'accent-subtle'] as const

/** The pane of the Plans screen. */
export const PANE: Record<Theme, Colour> = { light: surface('surface-0', 'light'), dark: surface('surface-0', 'dark') }

function flatten(c: Colour, under: Colour): Rgb {
  const flat = c.alpha >= 1 ? c : { rgb: c.rgb.map((v, i) => v * c.alpha + under.rgb[i] * (1 - c.alpha)) as Rgb, alpha: 1 }
  return flat.rgb
}

/** WCAG ratio of `fg` on `bg`; both are laid over `base` (default white) when they are translucent. */
export function ratio(fg: Colour, bg: Colour, base: Colour = WHITE): number {
  const under: Colour = { rgb: flatten(bg, base), alpha: 1 }
  return contrastRatio(flatten(fg, under), under.rgb)
}

/** The text or background colour a token class of the element paints in `theme`; `/40` is its opacity. */
export function colourOf(el: Element, prop: 'text' | 'bg', theme: Theme): Colour {
  const classes = (el.getAttribute('class') ?? '').split(/\s+/)
  const shape = new RegExp(`^${prop}-(.+?)(?:/(\\d+))?$`)
  for (const c of classes) {
    const m = shape.exec(c)
    const rgb = m ? lookup(m[1], theme) : null
    if (m && rgb) return { rgb, alpha: m[2] === undefined ? 1 : Number(m[2]) / 100 }
  }
  throw new Error(`no ${prop} colour class on ${el.outerHTML.slice(0, 80)}`)
}
