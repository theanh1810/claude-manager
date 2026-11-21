import { useNoticeStore } from '@/stores/useNoticeStore'
import Banner from './Banner'

/** Rendered once in the app frame: floats under the header, never pushes content. */
export default function NoticeHost() {
  const notices = useNoticeStore((s) => s.notices)
  const dismiss = useNoticeStore((s) => s.dismiss)
  if (notices.length === 0) return null
  return (
    <div className="absolute right-4 top-header z-sticky flex max-h-[50vh] w-notice max-w-[calc(100%-32px)] flex-col gap-2 overflow-y-auto">
      {notices.map((n) => (
        <Banner key={n.id} tone={n.tone} layout="overlay" actions={n.actions} onDismiss={() => dismiss(n.id)}>
          {n.children}
        </Banner>
      ))}
    </div>
  )
}
