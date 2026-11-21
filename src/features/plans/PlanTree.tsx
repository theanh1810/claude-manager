// The Plans tree on plans_tree (design brief PL1, PL5): per project the groups "Thay đổi" (with "Đã đóng"), "Specs" and "Việc nhỏ (adhoc)".
// Rows are shown in the order the backend sends them. Read only: a row selects, nothing here edits or approves.

import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { ClipboardList, FileText, Inbox, RefreshCw } from 'lucide-react'
import { Children, useState, type ReactNode } from 'react'
import Button from '@/components/ui/Button'
import Disclosure from '@/components/ui/Disclosure'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import IconButton from '@/components/ui/IconButton'
import Skeleton from '@/components/ui/Skeleton'
import { api } from '@/lib/ipc'
import type { AdhocRow, PlanChangeRow, PlansTree } from '@/types/spec'
import { ApprovalBadge, VerdictMark } from './StatusMarks'

/** What the user picked in the tree. */
export type PlanSelection =
  | { kind: 'change'; project: string; change: PlanChangeRow }
  | { kind: 'file'; project: string; path: string; title: string }
  | { kind: 'adhoc'; project: string; run: AdhocRow }

interface Props {
  /** Path of the selected project; null is "Tất cả": every registered project is a group. */
  project: string | null
  selected: PlanSelection | null
  onSelect: (s: PlanSelection) => void
}

const PAGE = 20
const MUTED = 'text-xs text-ink-muted'

/**
 * A fixed-height row of the tree. The selected row has the accent-subtle fill and a 2px accent bar, so selection is
 * not colour alone; it is `aria-current`, not a toggle. (ListRow cannot be used here: it takes no click and no aria.)
 */
function TreeRow({
  height, selected, onClick, divided = false, children,
}: { height: 'h-[52px]' | 'h-8'; selected: boolean; onClick: () => void; divided?: boolean; children: ReactNode }) {
  return (
    <li className={clsx(divided && 'border-t border-line')}>
      <button
        type="button"
        aria-current={selected ? 'true' : undefined}
        onClick={onClick}
        className={clsx(
          'focus-inset relative flex w-full items-center gap-2 overflow-hidden border-b border-line px-3 text-left',
          height,
          selected ? 'bg-accent-subtle' : 'hover:bg-surface-2',
        )}
      >
        {selected && <span data-selected-bar aria-hidden="true" className="absolute inset-y-0 left-0 w-0.5 bg-accent-fg" />}
        {children}
      </button>
    </li>
  )
}

export default function PlanTree({ project, selected, onSelect }: Props) {
  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: api.listProjects,
    staleTime: 30_000,
  })
  const shown = project === null ? projects : projects.filter((p) => p.path === project)
  const list = project !== null && shown.length === 0 ? [{ id: project, name: project, path: project }] : shown

  if (!isLoading && list.length === 0) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="Chưa có project nào để theo dõi"
        description="Thêm project từ bộ chọn Project ở thanh bên."
      />
    )
  }
  return (
    <ul className="flex flex-col">
      {list.map((p) => (
        <ProjectNode key={`${project === null ? 'all' : 'one'}:${p.path}`} name={p.name} path={p.path} single={project !== null} selected={selected} onSelect={onSelect} />
      ))}
    </ul>
  )
}

function ProjectNode({
  name, path, single, selected, onSelect,
}: { name: string; path: string; single: boolean } & Pick<Props, 'selected' | 'onSelect'>) {
  const [open, setOpen] = useState(single)
  const queryClient = useQueryClient()
  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ['plans', path, 'tree'],
    queryFn: () => api.plansTree(path),
    enabled: open,
  })
  return (
    <li className="relative">
      <Disclosure
        level={2}
        open={open}
        onOpenChange={setOpen}
        title={<span className="min-w-0 truncate pr-8" title={path}>{name}</span>}
      >
        {isLoading && <Skeleton.Rows count={3} height={32} />}
        {isError && (
          <div className="p-3">
            <ErrorState
              variant="inline"
              title={`Không đọc được: ${String((error as Error)?.message ?? error)}`}
              onRetry={() => void refetch()}
              retrying={isRefetching}
            />
          </div>
        )}
        {!isError && data && data.openspec === 'missing' && (
          <>
            <MissingOpenspec single={single} />
            {data.adhoc.length > 0 && (
              <ul>
                <AdhocGroup project={path} runs={data.adhoc} selected={selected} onSelect={onSelect} />
              </ul>
            )}
          </>
        )}
        {!isError && data && data.openspec === 'present' && (
          <Groups project={path} tree={data} selected={selected} onSelect={onSelect} />
        )}
      </Disclosure>
      {open && (
        <div className="absolute right-1 top-0.5">
          <IconButton
            size="sm"
            icon={RefreshCw}
            label="Đọc lại plan và spec"
            onClick={() => void queryClient.invalidateQueries({ queryKey: ['plans', path] })}
          />
        </div>
      )}
    </li>
  )
}

function MissingOpenspec({ single }: { single: boolean }) {
  if (!single) return <p className={clsx('px-6 py-1', MUTED)}>Chưa có plan agent-hub</p>
  return (
    <EmptyState
      icon={ClipboardList}
      title="Project này chưa có plan agent-hub"
      description="Chưa thấy thư mục openspec/. Thay đổi và spec sẽ hiện ở đây sau khi agent-hub tạo plan đầu tiên trong project."
    />
  )
}

function Groups({ project, tree, selected, onSelect }: { project: string; tree: PlansTree } & Pick<Props, 'selected' | 'onSelect'>) {
  const openChanges = tree.changes.filter((c) => !c.closed)
  const closedChanges = tree.changes.filter((c) => c.closed)
  const specFiles = [
    ...(tree.debt ? [{ path: tree.debt, title: '_debt.md' }] : []),
    ...(tree.glossary ? [{ path: tree.glossary, title: 'glossary.md' }] : []),
  ]
  return (
    <ul>
      <TreeGroup title="Thay đổi" count={tree.changes.length} level={3} defaultOpen>
        {openChanges.length === 0 && (
          <li>
            <EmptyState
              variant="inline"
              icon={Inbox}
              title={closedChanges.length === 0 ? 'Chưa có thay đổi nào' : 'Không có thay đổi nào đang mở'}
            />
          </li>
        )}
        {openChanges.map((c) => (
          <ChangeRow key={c.dir} project={project} change={c} selected={selected} onSelect={onSelect} />
        ))}
        {closedChanges.length > 0 && (
          <li>
            <TreeGroup title="Đã đóng" count={closedChanges.length} level={4} paged>
              {closedChanges.map((c) => (
                <ChangeRow key={c.dir} project={project} change={c} selected={selected} onSelect={onSelect} />
              ))}
            </TreeGroup>
          </li>
        )}
      </TreeGroup>
      <TreeGroup title="Specs" count={tree.specs.length} level={3}>
        {tree.specs.length === 0 && (
          <li>
            <EmptyState variant="inline" icon={Inbox} title="Chưa có spec nào" />
          </li>
        )}
        {tree.specs.map((s) => (
          <FileRow key={s.path} project={project} path={s.path} title={s.capability} selected={selected} onSelect={onSelect} />
        ))}
        {specFiles.map((f, i) => (
          <FileRow
            key={f.path}
            project={project}
            path={f.path}
            title={f.title}
            divided={i === 0}
            selected={selected}
            onSelect={onSelect}
          />
        ))}
      </TreeGroup>
      <AdhocGroup project={project} runs={tree.adhoc} selected={selected} onSelect={onSelect} />
    </ul>
  )
}

/** Runs made without a plan; the backend sends them newest first. Shown even when the project has no openspec/. */
function AdhocGroup({ project, runs, selected, onSelect }: { project: string; runs: AdhocRow[] } & Pick<Props, 'selected' | 'onSelect'>) {
  return (
    <TreeGroup title="Việc nhỏ (adhoc)" count={runs.length} level={3} paged>
      {runs.length === 0 && (
        <li>
          <EmptyState variant="inline" icon={Inbox} title="Chưa có việc nhỏ nào" />
        </li>
      )}
      {runs.map((r) => (
        <AdhocRunRow key={r.dir} project={project} run={r} selected={selected} onSelect={onSelect} />
      ))}
    </TreeGroup>
  )
}

/**
 * A Disclosure of rows. `paged` shows the first PAGE children and a "Hiện thêm" button for the rest
 * (design brief R3); every child is one `<li>` element.
 */
function TreeGroup({
  title, count, level, defaultOpen = false, paged = false, children,
}: { title: string; count: number; level: 3 | 4; defaultOpen?: boolean; paged?: boolean; children: ReactNode }) {
  const [limit, setLimit] = useState(PAGE)
  const items = Children.toArray(children)
  const visible = paged ? items.slice(0, limit) : items
  const rest = items.length - visible.length
  const group = (
    <Disclosure title={title} count={count} level={level} defaultOpen={defaultOpen}>
      <ul>
        {visible}
        {rest > 0 && (
          <li className="px-3 py-1.5">
            <Button variant="ghost" size="sm" onClick={() => setLimit((l) => l + PAGE)}>
              Hiện thêm {Math.min(PAGE, rest)}
            </Button>
          </li>
        )}
      </ul>
    </Disclosure>
  )
  return level === 3 ? <li>{group}</li> : group
}

function ChangeRow({
  project, change: c, selected, onSelect,
}: { project: string; change: PlanChangeRow } & Pick<Props, 'selected' | 'onSelect'>) {
  const active = selected?.kind === 'change' && selected.project === project && selected.change.dir === c.dir
  const tasks = c.tasks_unreadable
    ? null
    : c.tasks_done !== null && c.tasks_total !== null
      ? `${c.tasks_done}/${c.tasks_total} task`
      : 'chưa có task'
  const tasksText = tasks && <span className={clsx('tabular-nums', MUTED)}>{tasks}</span>
  return (
    <TreeRow height="h-[52px]" selected={active} onClick={() => onSelect({ kind: 'change', project, change: c })}>
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-0">
        <span className="flex h-5 items-center gap-2">
          <span className="flex-1 truncate font-mono text-sm font-medium" title={c.id}>{c.id}</span>
          {c.latest_verdict && <VerdictMark verdict={c.latest_verdict} variant="compact" />}
        </span>
        <span className="flex h-5 items-center gap-2">
          {c.closed ? (
            <>
              {c.archived_date && <span className="tabular-nums text-xs text-ink-subtle">{c.archived_date}</span>}
              {tasksText}
            </>
          ) : (
            <>
              {tasksText}
              <ApprovalBadge approval={c.approval} />
            </>
          )}
        </span>
      </span>
    </TreeRow>
  )
}

function FileRow({
  project, path, title, divided = false, selected, onSelect,
}: { project: string; path: string; title: string; divided?: boolean } & Pick<Props, 'selected' | 'onSelect'>) {
  const active = selected?.kind === 'file' && selected.project === project && selected.path === path
  return (
    <TreeRow height="h-8" divided={divided} selected={active} onClick={() => onSelect({ kind: 'file', project, path, title })}>
      <FileText aria-hidden="true" size={14} className="shrink-0 text-ink-subtle" />
      <span className="flex-1 truncate text-sm" title={title}>{title}</span>
    </TreeRow>
  )
}

function AdhocRunRow({
  project, run, selected, onSelect,
}: { project: string; run: AdhocRow } & Pick<Props, 'selected' | 'onSelect'>) {
  const active = selected?.kind === 'adhoc' && selected.project === project && selected.run.dir === run.dir
  return (
    <TreeRow height="h-8" selected={active} onClick={() => onSelect({ kind: 'adhoc', project, run })}>
      <span className="flex-1 truncate text-sm" title={run.slug}>{run.slug}</span>
      {run.date && <span className="tabular-nums text-xs text-ink-subtle">{run.date}</span>}
    </TreeRow>
  )
}
