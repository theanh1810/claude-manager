import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued'
import Segmented from '@/components/ui/Segmented'
import Switch from '@/components/ui/Switch'
import { useElementSize } from '@/hooks/useElementSize'
import { useMediaQuery } from '@/hooks/useMediaQuery'

interface Props {
  before: string
  after: string
}

type View = 'split' | 'unified'

const CHANGED_ONLY_KEY = 'cm.diffChangedOnly'
const VIEW_KEY = 'cm.diffView'
/** Below this width of the detail area the default view is Gộp. */
const SPLIT_MIN_WIDTH = 640
/** A file with more lines than this diffs by line: word diffing costs too much. */
const WORD_DIFF_MAX_LINES = 2000
const CONTEXT_LINES = 3

const VIEW_OPTIONS = [
  { value: 'split' as const, label: 'Chia đôi' },
  { value: 'unified' as const, label: 'Gộp' }
]

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // The choice still holds for this session when storage is unavailable.
  }
}

const token = (name: string) => `rgb(var(--${name}))`

// Light and dark point at the same variables: the theme blocks of globals.css switch their values.
const themeVariables = {
  diffViewerBackground: token('surface-0'),
  diffViewerColor: token('ink'),
  gutterBackground: token('surface-1'),
  gutterBackgroundDark: token('surface-1'),
  gutterColor: token('ink-muted'),
  addedBackground: token('diff-add-bg'),
  addedColor: token('ink'),
  addedGutterBackground: token('diff-add-gutter'),
  addedGutterColor: token('ink'),
  removedBackground: token('diff-del-bg'),
  removedColor: token('ink'),
  removedGutterBackground: token('diff-del-gutter'),
  removedGutterColor: token('ink'),
  wordAddedBackground: token('diff-add-word'),
  wordRemovedBackground: token('diff-del-word'),
  codeFoldBackground: token('surface-2'),
  codeFoldContentColor: token('ink-muted'),
  emptyLineBackground: token('surface-1'),
  diffViewerTitleBackground: token('surface-1'),
  diffViewerTitleColor: token('ink'),
  diffViewerTitleBorderColor: token('line')
}

const viewerStyles = {
  variables: { light: themeVariables, dark: themeVariables },
  contentText: { fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: '20px' },
  line: { padding: 0 },
  gutter: { minWidth: 48, padding: '0 8px', fontSize: 12 },
  marker: { padding: '0 8px', fontWeight: 700 }
}

/** The library wraps this text in a real button, so the fold opens from the keyboard. */
function renderFold(hidden: number) {
  return <span className="font-sans text-xs">{`Hiện ${hidden} dòng không đổi`}</span>
}

function lineCount(text: string) {
  let n = 1
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) n++
  return n
}

function DiffViewInner({ before, after }: Props) {
  const dark = useMediaQuery('(prefers-color-scheme: dark)')
  const [box, { width }] = useElementSize<HTMLDivElement>()
  const [changedOnly, setChangedOnly] = useState(() => read(CHANGED_ONLY_KEY) !== '0')
  const [chosen, setChosen] = useState<View | null>(() => {
    const saved = read(VIEW_KEY)
    return saved === 'split' || saved === 'unified' ? saved : null
  })
  // Width 0 means not measured yet: keep the wide default instead of flashing the narrow one.
  const view: View = chosen ?? (width > 0 && width < SPLIT_MIN_WIDTH ? 'unified' : 'split')

  const onChangedOnly = useCallback((on: boolean) => {
    setChangedOnly(on)
    write(CHANGED_ONLY_KEY, on ? '1' : '0')
  }, [])
  const onView = useCallback((next: View) => {
    setChosen(next)
    write(VIEW_KEY, next)
  }, [])

  const compareMethod = useMemo(
    () => (Math.max(lineCount(before), lineCount(after)) > WORD_DIFF_MAX_LINES ? DiffMethod.LINES : DiffMethod.WORDS),
    [before, after]
  )

  const scroller = useRef<HTMLElement>(null)
  // The library also makes every fold row a second tab stop beside its fold button. The rows are built
  // after the first render and again when a fold opens, so the row's role and tabindex are removed
  // whenever the section's rows change; removing attributes does not retrigger the observer.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const clean = () =>
      el.querySelectorAll('tr[role="button"]').forEach((row) => {
        row.removeAttribute('role')
        row.removeAttribute('tabindex')
      })
    clean()
    const observer = new MutationObserver(clean)
    observer.observe(el, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  const split = view === 'split'
  return (
    <div ref={box} data-theme={dark ? 'dark' : 'light'} className="flex h-full min-h-0 flex-col">
      <div className="flex h-diff-bar shrink-0 items-center justify-between gap-3 border-b border-line bg-surface-1 px-3">
        <div className="w-44">
          <Switch layout="row" label="Chỉ dòng thay đổi" checked={changedOnly} onCheckedChange={onChangedOnly} />
        </div>
        <Segmented aria-label="Kiểu hiển thị diff" value={view} onChange={onView} options={VIEW_OPTIONS} />
      </div>
      <section aria-label="Diff" ref={scroller} tabIndex={0} className="min-h-0 flex-1 overflow-auto">
        <ReactDiffViewer
          oldValue={before}
          newValue={after}
          splitView={split}
          useDarkTheme={dark}
          compareMethod={compareMethod}
          hideLineNumbers={false}
          hideSummary
          styles={viewerStyles as never}
          showDiffOnly={changedOnly}
          extraLinesSurroundingDiff={CONTEXT_LINES}
          codeFoldMessageRenderer={renderFold}
          leftTitle={split ? 'Trước' : undefined}
          rightTitle={split ? 'Sau' : undefined}
        />
      </section>
    </div>
  )
}

export default memo(DiffViewInner)
