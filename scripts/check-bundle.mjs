#!/usr/bin/env node
// Bundle gate for the ui-redesign plan (design D15).
//
// Two assertions on the entry chunk, the script `dist/index.html` loads, and
// the chunks it imports statically (they ship with it):
//   1. their summed gzip size, measured here with node:zlib, is at most CAP_KB
//      (120 kB).
//   2. none of them holds a markdown, diff or syntax-highlight library: those
//      load behind React.lazy only.
//
// The cap is absolute. CHECK_BUNDLE_CAP_KB may only lower it (a test hook to
// prove the gate can fail); a larger value is ignored. CHECK_BUNDLE_DIST points
// at another build folder, for the same reason.
//
// Run `node scripts/check-bundle.mjs` after `vite build`.

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

const CAP_KB = 120
const FORBIDDEN = [
  'react-markdown',
  'micromark',
  // react-diff-viewer-continued writes its emotion cache key (`key:"react-diff"`) into its chunk;
  // the package name itself is in no built chunk, so `react-diff-viewer` would never match.
  'react-diff',
  'prism-react-renderer',
  'prismjs',
  'prism-code',
]

const kb = (n) => `${(n / 1024).toFixed(2)} kB`

function fail(msg) {
  console.error(`✗ ${msg}`)
  process.exitCode = 1
}

const requested = Number(process.env.CHECK_BUNDLE_CAP_KB)
const capKb = Number.isFinite(requested) && requested > 0 ? Math.min(CAP_KB, requested) : CAP_KB
const capBytes = capKb * 1024

const dist = resolve(process.env.CHECK_BUNDLE_DIST ?? join(process.cwd(), 'dist'))
const htmlPath = join(dist, 'index.html')
if (!existsSync(htmlPath)) {
  console.error(`✗ ${htmlPath} not found; run \`vite build\` first.`)
  process.exit(1)
}

// The entry is the module script of index.html, never "the first index-*.js":
// Vite names several chunks index-<hash>.js.
const html = readFileSync(htmlPath, 'utf8')
const entryMatch = html.match(/<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["']/)
  ?? html.match(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*\btype=["']module["']/)
if (!entryMatch) {
  console.error('✗ no module <script src> in dist/index.html; build output changed?')
  process.exit(1)
}
const assetPath = (src) => join(dist, src.replace(/^\.?\//, ''))
const entry = entryMatch[1]
const entryFile = assetPath(entry)
if (!existsSync(entryFile)) {
  console.error(`✗ entry ${entry} named by index.html is not in ${dist}`)
  process.exit(1)
}

const entryBytes = readFileSync(entryFile)
const gz = gzipSync(entryBytes).length

console.log(`entry chunk : ${entry} (from dist/index.html)`)
console.log(`  raw       : ${kb(entryBytes.length)}`)
console.log(`  gzip      : ${kb(gz)}`)
console.log(`  cap       : ${kb(capBytes)}${capKb < CAP_KB ? ` (lowered by CHECK_BUNDLE_CAP_KB, the plan cap is ${CAP_KB} kB)` : ''}`)

// Chunks the entry imports statically ship with it. Dynamic import("./x.js")
// has a parenthesis and is not matched.
const staticImport = /(?:\bfrom|\bimport)\s*["']\.\/([^"']+\.js)["']/g
const seen = new Map([[entry, entryBytes.toString('utf8')]])
const queue = [entry]
while (queue.length > 0) {
  const current = seen.get(queue.shift())
  for (const m of current.matchAll(staticImport)) {
    const name = `/assets/${m[1]}`
    if (seen.has(name)) continue
    const file = assetPath(name)
    if (!existsSync(file)) continue
    seen.set(name, readFileSync(file, 'utf8'))
    queue.push(name)
  }
}
if (seen.size > 1) {
  console.log(`  static imports: ${[...seen.keys()].slice(1).join(', ')}`)
}
const sumGz = [...seen.values()].reduce((n, text) => n + gzipSync(text).length, 0)
console.log(`  entry + static imports gzip : ${kb(sumGz)} (${seen.size} chunk${seen.size === 1 ? '' : 's'})`)
if (sumGz > capBytes) {
  fail(`entry plus static imports is ${kb(sumGz)} gzip, over the ${kb(capBytes)} cap. Move weight behind React.lazy; never raise the cap.`)
}

for (const [name, text] of seen) {
  const leaked = FORBIDDEN.filter((t) => text.includes(t))
  if (leaked.length > 0) {
    fail(`${name} holds ${leaked.join(', ')}. Markdown, diff and prism code must load only behind React.lazy.`)
  }
}
if (!process.exitCode) {
  console.log(`  forbidden   : none of ${FORBIDDEN.join(', ')} in the entry or its static imports ✓`)
}

console.log(process.exitCode ? '\nBundle gate FAILED.' : '\nBundle gate passed.')
