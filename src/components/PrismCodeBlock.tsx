// PrismCodeBlock — syntax-highlighted <pre> for fenced code blocks in MarkdownView. Isolated in its
// own file so MarkdownView can pull it in via `React.lazy(() => import('./PrismCodeBlock'))`, which
// keeps prism-react-renderer (plus its language grammar payload) OUT of the main chunk.
//
// The box (surface, border, text colour) comes from tokens; only the token colours come from the
// Prism theme, picked by prefers-color-scheme and following it live through useMediaQuery.
//
// Default export is intentional: React.lazy requires a module shaped like `{ default: Component }`.

import { Highlight, themes } from 'prism-react-renderer'
import { useMediaQuery } from '@/hooks/useMediaQuery'

interface Props {
  code: string
  language: string
}

export default function PrismCodeBlock({ code, language }: Props) {
  const dark = useMediaQuery('(prefers-color-scheme: dark)')
  const theme = dark ? themes.vsDark : themes.vsLight

  return (
    <Highlight code={code} language={language} theme={theme}>
      {({ className, tokens, getLineProps, getTokenProps }) => (
        <pre
          data-testid="prism-block"
          data-prism={language}
          className={`${className} overflow-x-auto whitespace-pre rounded-lg border border-line bg-surface-1 p-3 text-xs text-ink [overflow-wrap:normal]`}
        >
          {tokens.map((line, i) => (
            // getLineProps returns key-less props; provide our own row key.
            <div key={i} {...getLineProps({ line })}>
              {line.map((token, j) => (
                <span key={j} {...getTokenProps({ token })} />
              ))}
            </div>
          ))}
        </pre>
      )}
    </Highlight>
  )
}
