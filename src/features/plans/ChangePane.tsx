// Detail pane of the Plans tab on plans_change (design brief PL2) and the file view (PL3).
// Read only: no approve, stamp, edit or comment control, no field. The caller passes the row picked in the tree,
// whose id, approval and closed state fill the header while the detail is still being read.

import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, FileText as FileIcon } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import Banner from '@/components/ui/Banner'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import Skeleton from '@/components/ui/Skeleton'
import { api } from '@/lib/ipc'
import type { PlanApproval, PlanChangeDetail, PlanChangeRow } from '@/types/spec'
import DocAccordion, { FileText } from './DocAccordion'
import { ErrorRounds, RawFallback, ReadError, ReviewRounds } from './RoundsSections'
import { ApprovalBadge, Breadcrumb, ClosedMark } from './StatusMarks'
import TaskProgress from './TaskProgress'

const MUTED = 'text-xs text-ink-muted'

interface HeaderFields {
  id: string
  approval: PlanApproval
  closed: boolean
  archived_date: string | null
}

function Header({ change }: { change: HeaderFields }) {
  return (
    <header className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-md font-semibold font-mono [overflow-wrap:anywhere]">{change.id}</h2>
        <ApprovalBadge approval={change.approval} />
        {change.closed && <ClosedMark />}
      </div>
      <p className={MUTED}>
        {change.closed
          ? `Đã đóng${change.archived_date ? ` ngày ${change.archived_date}` : ''} · chỉ đọc`
          : 'Duyệt trong Claude Code'}
      </p>
    </header>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h3 id={headingId} className="text-sm font-semibold">
        {title}
      </h3>
      {children}
    </section>
  )
}

// The sentence under "Duyệt plan". A closed change keeps the first sentence only, so it no longer invites the
// reader to approve in Claude Code (written out: the first full stop of the open text is inside "approval.md").
const APPROVAL_LINE: Record<PlanApproval, { open: string; closed: string }> = {
  approved: { open: 'Dấu duyệt khớp với plan hiện tại.', closed: 'Dấu duyệt khớp với plan hiện tại.' },
  not_approved: {
    open: 'Chưa có dấu duyệt trong approval.md. Duyệt trong Claude Code.',
    closed: 'Chưa có dấu duyệt trong approval.md.',
  },
  stale: {
    open: 'Plan đã đổi sau lần duyệt trước. Duyệt lại trong Claude Code.',
    closed: 'Plan đã đổi sau lần duyệt trước.',
  },
}

function ApprovalSection({ approval, closed }: { approval: PlanApproval; closed: boolean }) {
  const lineId = useId()
  // A value outside the contract has no explanation line; the badge above renders nothing for it as well.
  const lines = APPROVAL_LINE[approval] as (typeof APPROVAL_LINE)[PlanApproval] | undefined
  const line = lines?.[closed ? 'closed' : 'open']
  return (
    <Section title="Duyệt plan">
      <ApprovalBadge approval={approval} />
      {approval === 'stale' ? (
        <Banner tone="danger" icon={AlertTriangle} role="region" aria-labelledby={lineId}>
          <p id={lineId}>{line}</p>
        </Banner>
      ) : (
        line && <p className={MUTED}>{line}</p>
      )}
    </Section>
  )
}

function Body({ project, detail }: { project: string; detail: PlanChangeDetail }) {
  return (
    <>
      <ApprovalSection approval={detail.approval} closed={detail.closed} />
      <Section title="Tiến độ">
        {detail.tasks.state === 'missing' && <EmptyState variant="inline" icon={FileIcon} title="Chưa có tasks.md" />}
        {detail.tasks.state === 'error' && <ReadError message={detail.tasks.message} />}
        {detail.tasks.state === 'unreadable' && <RawFallback name="tasks.md" raw={detail.tasks.raw} />}
        {detail.tasks.state === 'ok' && <TaskProgress tasks={detail.tasks} />}
      </Section>
      <Section title="Review">
        <ReviewRounds section={detail.review} />
      </Section>
      <Section title="Test">
        <ErrorRounds section={detail.errors} />
      </Section>
      <Section title="Tài liệu">
        {detail.docs.length === 0 ? (
          <EmptyState variant="inline" icon={FileIcon} title="Thay đổi này chưa có tài liệu nào" />
        ) : (
          <DocAccordion project={project} docs={detail.docs} />
        )}
      </Section>
    </>
  )
}

/** One change of the tree: breadcrumb, header, approval, progress, review, test rounds and documents. */
export default function ChangePane({ project, change }: { project: string; change: PlanChangeRow }) {
  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['plans', project, 'change', change.dir],
    queryFn: () => api.plansChange(project, change.dir),
  })
  const shown = error ? change : (data ?? change)
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-6" aria-busy={isLoading}>
      <Breadcrumb project={project} group={shown.closed ? 'Đã đóng' : 'Thay đổi'} current={change.id} />
      <Header change={shown} />
      {isLoading &&
        ['Duyệt plan', 'Tiến độ', 'Review', 'Test', 'Tài liệu'].map((title) => (
          <Section key={title} title={title}>
            <Skeleton.Rows count={2} height={16} />
          </Section>
        ))}
      {error && (
        <div className="min-h-0 flex-1">
          <ErrorState
            title={`Không đọc được: ${String((error as Error).message ?? error)}`}
            onRetry={() => void refetch()}
            retrying={isRefetching}
          />
        </div>
      )}
      {data && !error && <Body project={project} detail={data} />}
    </div>
  )
}

/** A spec, `_debt.md` or `glossary.md` of the tree; no status badge. */
export function SpecFileView({ project, path, title }: { project: string; path: string; title: string }) {
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-6">
      <Breadcrumb project={project} group="Specs" current={title} />
      <header>
        <h2 className="text-md font-semibold [overflow-wrap:anywhere]">{title}</h2>
      </header>
      <FileText project={project} path={path} headingLevel={3} />
    </div>
  )
}
