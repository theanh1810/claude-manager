// PlansTab: 2-column shell. The list pane holds the plan tree of the selected
// project; the detail pane shows the selected change or file.
//
// Everything is read from disk at run time through IPC; nothing is
// discovered at build time.

import { ClipboardList } from 'lucide-react'
import { useEffect, useState } from 'react'

import EmptyState from '@/components/ui/EmptyState'
import AdhocDetail from './AdhocDetail'
import ChangePane, { SpecFileView } from './ChangePane'
import PlanTree, { type PlanSelection } from './PlanTree'

interface Props {
  /**
   * Selected project: a path, or null for every registered project ("Tất cả").
   * Left out, the plan tree is not shown.
   */
  project?: string | null
}

function Detail({ selection }: { selection: PlanSelection | null }) {
  switch (selection?.kind) {
    case 'change':
      return <ChangePane key={`${selection.project}:${selection.change.dir}`} project={selection.project} change={selection.change} />
    case 'file':
      return <SpecFileView project={selection.project} path={selection.path} title={selection.title} />
    case 'adhoc':
      return <AdhocDetail key={`${selection.project}:${selection.run.dir}`} project={selection.project} run={selection.run} />
    default:
      return <EmptyState icon={ClipboardList} title="Chọn một thay đổi, spec hoặc việc nhỏ để xem chi tiết." />
  }
}

export default function PlansTab({ project }: Props) {
  const [selection, setSelection] = useState<PlanSelection | null>(null)
  useEffect(() => {
    setSelection(null)
  }, [project])

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1">
      <div className="flex w-pane shrink-0 select-none flex-col overflow-y-auto border-r border-line bg-surface-0">
        {project !== undefined && <PlanTree project={project} selected={selection} onSelect={setSelection} />}
      </div>
      <section className="min-w-0 flex-1 overflow-hidden bg-surface-0">
        <Detail selection={selection} />
      </section>
    </div>
  )
}
