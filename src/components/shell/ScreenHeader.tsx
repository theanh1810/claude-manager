import type { ReactNode, Ref } from 'react'

interface Props {
  title: string
  /** Always reserves its 16px line, so a subtitle arriving later moves nothing. */
  subtitle?: string
  actions?: ReactNode
  /** The h1 takes focus when the screen changes. */
  headingRef?: Ref<HTMLHeadingElement>
}

/** The 48px header of a screen: the one visible h1, a subtitle line and the screen's actions. */
export default function ScreenHeader({ title, subtitle, actions, headingRef }: Props) {
  return (
    <header className="flex h-header shrink-0 items-center gap-3 border-b border-line bg-surface-0 px-4">
      <div className="min-w-0 flex-1">
        <h1 ref={headingRef} tabIndex={-1} className="truncate text-md font-semibold text-ink outline-none">
          {title}
        </h1>
        <p className="h-4 truncate text-xs text-ink-muted">{subtitle}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">{actions}</div>
    </header>
  )
}
