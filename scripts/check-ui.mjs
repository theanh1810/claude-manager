#!/usr/bin/env node
// UI audit for the ui-redesign plan (design D15, tokens.md §8, copy.md §4).
//
// Walks the TypeScript sources outside tests and reports, as file:line, every
// class, colour, dialog call or English label the redesign removed. It reads the
// TypeScript AST, so only string literals, template text and JSX text are
// matched: a comment that names `bg-slate-100` is not a finding.
//
// Exit 0 when every count is 0, exit 1 otherwise. `--root <dir>` audits another
// folder (used to prove the gate can fail).
//
// Run `node scripts/check-ui.mjs` from the repository root.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import ts from 'typescript'

const rootArg = process.argv.indexOf('--root')
const rootValue = rootArg > -1 ? process.argv[rootArg + 1] : undefined
const ROOT = resolve(rootArg > -1 ? (rootValue ?? '') : join(process.cwd(), 'src'))

// An audit that cannot read its root cannot pass: say so in one line, no stack.
if (rootValue === undefined && rootArg > -1) {
  console.error('✗ check-ui: <missing --root value> is not a folder')
  process.exit(1)
}
if (!statSync(ROOT, { throwIfNoEntry: false })?.isDirectory()) {
  console.error(`✗ check-ui: ${ROOT} is not a folder`)
  process.exit(1)
}

// The eight project identity colours are the only hex literals allowed.
const HEX_EXEMPT = new Set(['lib/projectColors.ts'])
// Widths named in the design brief; any other arbitrary px size is a finding.
const PX_ALLOWED = new Set([
  'max-w-[280px]', // EmptyState description (tokens.md §5)
  'max-w-[960px]', // screen content column (screens-other.md)
  'max-w-[520px]', // inline ErrorState (screens-other.md)
  'max-w-[96px]', // project name in a memory row (screens-other.md)
  'h-[52px]', // change row and sidebar footer row (screens-plans.md, checklist.md)
  'max-h-[360px]', // cleanup table body (screens-other.md)
  'min-w-[148px]', // copy-command button (screens-other.md)
  'w-[168px]', // counts column of a session row (screens-other.md)
])

const PALETTE =
  '(?:slate|gray|zinc|neutral|stone|rose|red|orange|amber|yellow|lime|emerald|green|teal|sky|blue|indigo|brand|violet|fuchsia|purple|pink|cyan|white|black)'
const COPY_WORDS = 'Pending|History|Accept|Reject|Rollback|Paused|Retention|Autostart|Recommended|Before|After'

// Each rule matches inside literal text. `(?<![\w-])` keeps `hover:bg-x` matched
// and `xbg-x` not.
const RULES = [
  {
    id: 'palette',
    label: 'raw palette class',
    re: new RegExp(
      `(?<![\\w-])(?:bg|text|border|ring|ring-offset|divide|from|via|to|fill|stroke|outline|shadow|decoration|caret|placeholder)-${PALETTE}\\b`,
      'g',
    ),
  },
  { id: 'hex', label: 'hex colour', re: /(?<![\w&])#[0-9a-fA-F]{3,8}\b/g, skip: (file) => HEX_EXEMPT.has(file) },
  { id: 'textSize', label: 'arbitrary text size', re: /(?<![\w-])text-\[/g },
  {
    id: 'px',
    label: 'arbitrary px class',
    re: /(?<![\w-])(?:min-|max-)?(?:w|h)-\[\d+(?:\.\d+)?px\]/g,
    allow: (m) => PX_ALLOWED.has(m),
  },
  { id: 'dark', label: 'dark: variant', re: /(?<![\w-])dark:/g },
  { id: 'transition', label: 'colour transition', re: /(?<![\w-])transition-(?:colors|all|shadow|\[)/g },
  {
    id: 'outline',
    label: 'outline-none outside the focused h1',
    re: /(?<![\w-])outline-none\b/g,
    allowNode: (node) => insideTag(node, 'h1') || insideSkipTarget(node),
  },
  {
    id: 'copy',
    label: 'English label of the copy denylist',
    re: new RegExp(
      `\\b(?:${COPY_WORDS})\\b|Toggle learning mode|edit pending|Thử reload cửa sổ|never touch|claude-manager v0\\.1\\.0`,
      'g',
    ),
  },
]
const CONFIRM = { id: 'confirm', label: 'window.confirm' }
const ALL = [...RULES, CONFIRM]

function insideTag(node, tag) {
  for (let n = node.parent; n; n = n.parent) {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) return n.tagName.getText() === tag
  }
  return false
}

// `<main tabIndex={-1}>` is the skip-link target: focused by script only, never a tab stop.
function insideSkipTarget(node) {
  for (let n = node.parent; n; n = n.parent) {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      if (n.tagName.getText() !== 'main') return false
      return n.attributes.properties.some(
        (p) => ts.isJsxAttribute(p) && p.name.getText() === 'tabIndex' && p.initializer?.getText().replace(/\s/g, '') === '{-1}',
      )
    }
  }
  return false
}

function isTestPath(rel) {
  return /\.test\.[tj]sx?$/.test(rel) || rel.split('/').includes('__tests__') || rel.startsWith('test/') || rel.endsWith('.d.ts')
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.[tj]sx?$/.test(entry.name)) out.push(full)
  }
  return out
}

const findings = []
let scanned = 0

function scanFile(full) {
  const rel = relative(ROOT, full).split(sep).join('/')
  if (isTestPath(rel)) return
  scanned += 1
  const sf = ts.createSourceFile(full, readFileSync(full, 'utf8'), ts.ScriptTarget.Latest, true, full.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  // `confirm` is a hook result in this app (useConfirm); only the browser dialog is banned.
  const declaresConfirm = /\b(?:const|let|var|function)\s+confirm\b|\bconfirm\s*[:,)]|\{[^}]*\bconfirm\b[^}]*\}\s*=/.test(sf.text)
  const add = (rule, node, offset, text) => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf) + offset).line + 1
    findings.push({ rule, file: rel, line, text })
  }

  const visit = (node) => {
    const literal =
      ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)
    const moduleSpecifier =
      node.parent && (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent) || ts.isLiteralTypeNode(node.parent) ||
        (ts.isCallExpression(node.parent) && node.parent.expression.kind === ts.SyntaxKind.ImportKeyword))
    if (literal && !moduleSpecifier) {
      const raw = node.getText(sf)
      for (const rule of RULES) {
        if (rule.skip?.(rel)) continue
        for (const m of raw.matchAll(rule.re)) {
          if (rule.allow?.(m[0]) || rule.allowNode?.(node)) continue
          add(rule, node, m.index, m[0])
        }
      }
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const bare = ts.isIdentifier(callee) && callee.text === 'confirm' && !declaresConfirm
      const viaGlobal =
        ts.isPropertyAccessExpression(callee) && callee.name.text === 'confirm' &&
        ts.isIdentifier(callee.expression) && ['window', 'globalThis'].includes(callee.expression.text)
      if (bare || viaGlobal) add(CONFIRM, node, 0, callee.getText(sf))
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

for (const file of walk(ROOT).sort()) scanFile(file)

for (const f of findings) console.log(`${f.file}:${f.line}  ${f.rule.label}: ${f.text}`)

const count = (id) => findings.filter((f) => f.rule.id === id).length
const summary = ALL.map((r) => `${r.label} ${count(r.id)}`).join(', ')
console.log(`check-ui: ${summary} (${scanned} files scanned)`)
if (findings.length > 0) {
  console.error('\nUI audit FAILED.')
  process.exit(1)
}
console.log('UI audit passed.')
