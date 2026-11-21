import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import ErrorState from '@/components/ui/ErrorState'
import { errorText } from '@/lib/format'
import { api } from '@/lib/ipc'
import MemoryDetail from './MemoryDetail'
import MemoryList from './MemoryList'

interface Props {
  /** Path of the selected project; null is "Tất cả". */
  project: string | null
  onOpenSettings?: () => void
}

export default function MemoryTab({ project, onOpenSettings }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ['memory', project],
    queryFn: () => api.memoryList(project),
    staleTime: 10_000,
  })
  const entries = data?.entries ?? []
  const selected = entries.find((e) => e.id === selectedId) ?? null

  if (isError) {
    return (
      <div className="h-full min-w-0 flex-1">
        <ErrorState title="Lỗi tải memory." detail={errorText(error)} onRetry={() => void refetch()} retrying={isRefetching} />
      </div>
    )
  }
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1">
      <div className="flex w-pane shrink-0 select-none flex-col border-r border-line bg-surface-0">
        <MemoryList
          entries={entries}
          problems={data?.problems ?? []}
          mem0={data?.mem0 ?? { state: 'available' }}
          loading={isLoading}
          scoped={project !== null}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onOpenSettings={onOpenSettings}
        />
      </div>
      <section className="min-w-0 flex-1 overflow-hidden bg-surface-0">
        <MemoryDetail entry={selected} onOpenFile={(p) => void api.memoryOpenFile(p)} />
      </section>
    </div>
  )
}
