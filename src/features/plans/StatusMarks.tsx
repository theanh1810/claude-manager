// Approval, closed and verdict marks of the Plans tab, and the breadcrumb of its detail panes. A mark is the StatusMark
// primitive, so status is always an icon and words (or an accessible name), never colour alone (design brief S1, S2, R1, R2).

import { ChevronRight } from 'lucide-react'
import { Fragment } from 'react'
import Badge from '@/components/ui/Badge'
import StatusMark, { STATUS_MARKS } from '@/components/ui/StatusMark'
import type { PlanApproval, PlanVerdict } from '@/types/spec'

export function ApprovalBadge({ approval }: { approval: PlanApproval }) {
  return <StatusMark kind="approval" value={approval} />
}

export function ClosedMark() {
  return <StatusMark kind="mark" value="closed" />
}

interface VerdictProps {
  verdict: PlanVerdict
  /** `compact` is the bare icon of a tree row; `full` is a badge with the word. */
  variant: 'compact' | 'full'
}

export function VerdictMark({ verdict, variant }: VerdictProps) {
  if (variant === 'full') return <StatusMark kind="verdict" value={verdict} />
  const mark = STATUS_MARKS.verdict[verdict] as (typeof STATUS_MARKS.verdict)[PlanVerdict] | undefined
  if (!mark) return null // a value outside the contract reads as no verdict
  return <Badge compact tone={mark.tone} icon={mark.icon} label={`Test gần nhất: ${mark.label.toLocaleLowerCase('vi')}`} />
}

interface BreadcrumbProps {
  /** Absolute path of the project: its folder name is shown, the whole path is the title. */
  project: string
  /** The tree group the page sits in: "Thay đổi", "Đã đóng", "Specs" or "Việc nhỏ (adhoc)". */
  group: string
  current: string
}

/** Where a detail pane sits in the tree; the last part is the page. */
export function Breadcrumb({ project, group, current }: BreadcrumbProps) {
  const folder = project.split(/[\\/]/).filter(Boolean).pop() ?? project
  const parts = [
    { label: folder, title: project },
    { label: group, title: undefined },
    { label: current, title: undefined },
  ]
  return (
    <nav aria-label="Vị trí" className="text-xs text-ink-muted">
      <ol className="flex items-center gap-1">
        {parts.map((p, i) => (
          <Fragment key={p.label + i}>
            {i > 0 && <ChevronRight aria-hidden="true" size={12} className="shrink-0" />}
            <li title={p.title} aria-current={i === parts.length - 1 ? 'page' : undefined} className="min-w-0 truncate">
              {p.label}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  )
}
