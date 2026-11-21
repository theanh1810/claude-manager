// MarkdownView — thin wrapper that loads the react-markdown + remark-gfm pipeline lazily and
// renders it inside the `.md` document styles of globals.css.
//
// Constraints:
//   * The pipeline (react-markdown, remark-gfm and the micromark packages behind them) is a dynamic
//     import, so none of it is in the main chunk; the skeleton rows hold the place until it lands.
//   * Fenced code with a language pulls in prism-react-renderer through React.lazy, again outside
//     the main chunk; a fenced block with no language and inline `code` stay plain elements.
//   * The viewer is read-only and the documents it shows are project files: no <img> (it would
//     fetch a remote address) and no <a> (a click would navigate the app window) is ever
//     rendered; the address shows as text.
//   * `headingLevel` is the level the document's own h1 renders at, so a document placed under an
//     h4 of the host never breaks the heading order; the visual size stays that of the source depth.

import { Children, isValidElement, lazy, Suspense, useEffect, useMemo, useState } from 'react'
import type { ComponentPropsWithoutRef, ComponentType, ElementType, ReactNode } from 'react'
import type { Options } from 'react-markdown'
import clsx from 'clsx'
import Skeleton from './ui/Skeleton'

// React.lazy MUST wrap a dynamic import that resolves to a module with a default export.
const PrismCodeBlock = lazy(() => import('./PrismCodeBlock'))

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

interface Props {
  markdown: string
  className?: string
  /** The heading level the document's own `#` renders at; deeper headings follow, capped at 6. Default 1. */
  headingLevel?: HeadingLevel
}

interface Pipeline {
  Markdown: ComponentType<Options>
  remarkGfm: NonNullable<Options['remarkPlugins']>[number]
}

let pipeline: Promise<Pipeline> | null = null
let loaded: Pipeline | null = null

/** One shared load for every document; a failed load is forgotten so the next mount tries again. */
function loadPipeline(): Promise<Pipeline> {
  pipeline ??= Promise.all([import('react-markdown'), import('remark-gfm')])
    .then(([md, gfm]) => (loaded = { Markdown: md.default, remarkGfm: gfm.default }))
    .catch((e) => {
      pipeline = null
      throw e
    })
  return pipeline
}

// react-markdown v10 replaced the older `inline` flag on the code renderer with a positional check:
// fenced blocks arrive wrapped in a <pre>, inline code does not. A fenced block with a language is
// told apart by the `language-*` className the parser adds.
type CodeRendererProps = ComponentPropsWithoutRef<'code'> & { inline?: boolean }

function CodeRenderer({ className, children, inline, ...rest }: CodeRendererProps) {
  const langMatch = /language-(\w+)/.exec(className || '')

  if (inline || !langMatch) {
    return (
      <code className={className} {...rest}>
        {children}
      </code>
    )
  }

  const language = langMatch[1]
  const raw = String(children).replace(/\n$/, '')

  // The fallback carries the raw code in the same box as the highlighted block: no layout jump.
  return (
    <Suspense
      fallback={
        <pre data-testid="prism-fallback" className="overflow-x-auto whitespace-pre rounded-lg border border-line bg-surface-1 p-3 text-xs [overflow-wrap:normal]">
          {raw}
        </pre>
      }
    >
      <PrismCodeBlock code={raw} language={language} />
    </Suspense>
  )
}

/** A block with a language brings its own <pre>; every other block scrolls sideways inside this one without breaking words. */
function PreRenderer({ children }: ComponentPropsWithoutRef<'pre'>) {
  const only = Children.toArray(children)[0]
  const highlighted = isValidElement<{ className?: string }>(only) && /language-\w+/.test(only.props.className ?? '')
  if (highlighted) return <>{children}</>
  return <pre className="overflow-x-auto whitespace-pre [overflow-wrap:normal]">{children}</pre>
}

/** Wide tables scroll inside their own box: cells keep whole words instead of wrapping them. */
function TableRenderer({ children }: ComponentPropsWithoutRef<'table'>) {
  return <table className="max-w-full [overflow-wrap:normal]">{children}</table>
}

function ImageAsText({ src, alt }: ComponentPropsWithoutRef<'img'>) {
  return <span>{`${alt ? `[Ảnh: ${alt}]` : '[Ảnh]'} ${src ?? ''}`.trim()}</span>
}

/** The text of `children` when it is plain text only. */
function plainText(children: ReactNode): string | null {
  const parts = Children.toArray(children)
  return parts.every((part) => typeof part === 'string') ? parts.join('') : null
}

/** An http(s) link reads `text (url)`, any other target (empty, relative, mailto:, javascript:, …) just `text`. */
function LinkAsText({ href, children }: ComponentPropsWithoutRef<'a'>) {
  if (!href || !/^https?:/i.test(href)) return <span>{children}</span>
  return (
    <>
      <span>{children}</span>
      {plainText(children) !== href && (
        <>
          {' '}
          <span className="font-mono">({href})</span>
        </>
      )}
    </>
  )
}

// The size and spacing of a heading come from its source depth (`.md h1` … `.md h4`). A heading that
// renders as another tag needs them back, and `!` is needed because the tag's own `.md` rule is more specific.
const HEADING_LOOK: Record<HeadingLevel, string> = {
  1: '!text-lg !mt-4 !mb-2 !font-semibold',
  2: '!text-md !mt-4 !mb-2 !font-semibold',
  3: '!text-sm !mt-3 !mb-1 !font-semibold',
  4: '!text-sm !mt-3 !mb-1 !font-semibold',
  5: '!text-sm !mt-3 !mb-1 !font-semibold',
  6: '!text-sm !mt-3 !mb-1 !font-semibold'
}

function headingComponents(base: HeadingLevel) {
  const out: Record<string, ComponentType<ComponentPropsWithoutRef<'h1'>>> = {}
  for (const depth of [1, 2, 3, 4, 5, 6] as const) {
    const level = Math.min(6, base + depth - 1) as HeadingLevel
    if (level === depth) continue
    const Tag = `h${level}` as ElementType
    out[`h${depth}`] = function Heading({ children }) {
      return <Tag className={clsx(HEADING_LOOK[depth])}>{children}</Tag>
    }
  }
  return out
}

export default function MarkdownView({ markdown, className, headingLevel = 1 }: Props) {
  const [ready, setReady] = useState<Pipeline | null>(loaded)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (ready) return
    let live = true
    loadPipeline().then(
      (p) => live && setReady(p),
      () => live && setFailed(true)
    )
    return () => {
      live = false
    }
  }, [ready])

  const components = useMemo(
    () => ({ code: CodeRenderer as never, pre: PreRenderer, table: TableRenderer, img: ImageAsText, a: LinkAsText, ...headingComponents(headingLevel) }),
    [headingLevel]
  )

  if (failed) return <pre className={clsx('whitespace-pre-wrap text-sm', className)}>{markdown}</pre>
  if (!ready) return <Skeleton.Rows count={3} height={20} />

  const { Markdown, remarkGfm } = ready
  return (
    <div className={clsx('md', className)}>
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {markdown}
      </Markdown>
    </div>
  )
}
