// Detail pane of a run made without a plan (design brief PL4): its record.md open and its independent.md collapsed.
// Read only: the files are read through plansRead and nothing here edits them.

import { FileText } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'
import type { AdhocRow, PlanDocRef } from '@/types/spec'
import DocAccordion from './DocAccordion'
import { Breadcrumb } from './StatusMarks'

/** One run of docs/changes/adhoc: breadcrumb, header, then its record and independent review. */
export default function AdhocDetail({ project, run }: { project: string; run: AdhocRow }) {
  const docs: PlanDocRef[] = [
    ...(run.has_record ? [{ label: 'record.md', path: `${run.dir}/record.md` }] : []),
    ...(run.has_independent ? [{ label: 'independent.md', path: `${run.dir}/independent.md` }] : []),
  ]
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-6">
      <Breadcrumb project={project} group="Việc nhỏ (adhoc)" current={run.slug} />
      <header className="flex flex-col gap-1">
        <h2 className="text-md font-semibold font-mono [overflow-wrap:anywhere]">{run.slug}</h2>
        <p className="text-xs text-ink-muted">
          {run.date ? `${run.date} · ` : ''}việc nhỏ chạy không qua plan · chỉ đọc
        </p>
      </header>
      {!run.has_record && <EmptyState variant="inline" icon={FileText} title="Chưa có record.md" />}
      {docs.length > 0 && (
        <section aria-labelledby="adhoc-docs">
          <h3 id="adhoc-docs" className="sr-only">
            Tài liệu
          </h3>
          <DocAccordion project={project} docs={docs} />
        </section>
      )}
    </div>
  )
}
