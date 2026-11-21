import clsx from 'clsx'
import { Ban, Check, CircleHelp, User } from 'lucide-react'
import type { Edit } from '@/types/edit'

interface Props {
  edit: Pick<Edit, 'source' | 'session_id' | 'decision'>
}

const ROW = 'flex min-w-0 flex-row items-center gap-x-2 whitespace-nowrap text-xs'

/**
 * Who made a recorded change, on one line. A change Claude Code's call matched shows
 * `Claude · session {id8}` and whether that call was allowed; anything else (unmatched or not yet
 * labelled) shows `không rõ / bạn tự sửa`. The words carry the meaning, colour is only a cue. A
 * recorded change exists only when the call went through, so only an explicit `reject` reads
 * `bị từ chối`.
 */
export default function SourceLabel({ edit }: Props) {
  if (edit.source !== 'claude') {
    return (
      <span className={ROW}>
        <span className="inline-flex items-center gap-1 text-ink-muted">
          <User size={14} aria-hidden="true" />
          không rõ / bạn tự sửa
        </span>
      </span>
    )
  }
  const id = edit.session_id ?? ''
  const rejected = edit.decision === 'reject'
  const unknown = edit.decision == null
  const Icon = rejected ? Ban : unknown ? CircleHelp : Check
  return (
    <span className={ROW}>
      <span
        title={id || undefined}
        className="inline-flex h-5 min-w-0 items-center truncate rounded-sm border border-line bg-accent-subtle px-1.5 text-xs font-medium text-accent-fg"
      >
        {id ? `Claude · session ${id.slice(0, 8)}` : 'Claude'}
      </span>
      <span className={clsx('inline-flex shrink-0 items-center gap-1', rejected ? 'text-danger-fg' : unknown ? 'text-ink-muted' : 'text-success-fg')}>
        <Icon size={14} aria-hidden="true" />
        {rejected ? 'bị từ chối' : unknown ? 'không rõ quyết định' : 'được phép'}
      </span>
    </span>
  )
}
