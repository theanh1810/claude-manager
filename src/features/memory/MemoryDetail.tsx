import { ExternalLink, FileText } from 'lucide-react'
import MarkdownView from '@/components/MarkdownView'
import Button from '@/components/ui/Button'
import EmptyState from '@/components/ui/EmptyState'
import StatusMark from '@/components/ui/StatusMark'
import type { MemoryEntry } from '@/types/memory'
import { sourceText } from './MemoryList'

interface Props {
  entry: MemoryEntry | null
  onOpenFile: (path: string) => void
}

/** Read-only detail: the text, its source, and "Mở file" for file entries. No edit or delete control. */
export default function MemoryDetail({ entry, onOpenFile }: Props) {
  if (!entry) return <EmptyState icon={FileText} title="Chọn một mục để xem chi tiết" />
  const markdown = entry.kind === 'error' ? '```yaml\n' + entry.text + '\n```' : entry.text
  const source = sourceText(entry)
  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-line bg-surface-1 px-4 py-3">
        <div className="min-w-0">
          <div className="flex h-4 items-center gap-1 text-xs text-ink-muted">
            <StatusMark kind="memory" value={entry.kind} />
            {entry.project && <span>{`· ${entry.project}`}</span>}
          </div>
          <code className="block h-5 truncate font-mono text-sm" title={source}>
            {source}
          </code>
        </div>
        {'path' in entry.source && (
          <Button size="sm" variant="secondary" icon={ExternalLink} onClick={() => onOpenFile((entry.source as { path: string }).path)}>
            Mở file
          </Button>
        )}
      </header>
      <div className="min-w-0 flex-1 overflow-y-auto p-4">
        <div className="max-w-[72ch]">
          <MarkdownView markdown={markdown} headingLevel={2} />
        </div>
      </div>
    </div>
  )
}
