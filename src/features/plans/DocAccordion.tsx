// The documents of a change as an accordion, several open at once (design brief PL2 "Tài liệu").
// Each document is read through plansRead only while it is open; a failed read shows in its own item.

import { useQuery } from '@tanstack/react-query'
import MarkdownView from '@/components/MarkdownView'
import Disclosure from '@/components/ui/Disclosure'
import ErrorState from '@/components/ui/ErrorState'
import { api } from '@/lib/ipc'
import type { PlanDocRef } from '@/types/spec'

/**
 * The text of one plan file; `path` is relative to the project. `headingLevel` is the level of the file's own h1:
 * 5 under a document accordion (h4), 3 for a spec shown under its h2.
 */
export function FileText({ project, path, headingLevel = 5 }: { project: string; path: string; headingLevel?: 1 | 2 | 3 | 4 | 5 | 6 }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['plans', project, 'read', path],
    queryFn: () => api.plansRead(project, path),
  })
  if (isLoading) return <p className="text-xs text-ink-muted">Đang tải…</p>
  if (error) return <ErrorState variant="inline" title={`Không đọc được: ${String((error as Error).message ?? error)}`} />
  return <MarkdownView markdown={data ?? ''} headingLevel={headingLevel} />
}

export default function DocAccordion({ project, docs }: { project: string; docs: PlanDocRef[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {docs.map((d, i) => (
        <li key={d.path} className="rounded-md border border-line">
          <Disclosure level={4} region defaultOpen={i === 0} title={<span className="font-mono text-sm [overflow-wrap:anywhere]">{d.label}</span>}>
            <div className="px-3 pb-3 pt-2">
              <FileText project={project} path={d.path} />
            </div>
          </Disclosure>
        </li>
      ))}
    </ul>
  )
}
