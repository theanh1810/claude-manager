import { useQuery } from '@tanstack/react-query'
import { Loader2, Sparkles, X } from 'lucide-react'
import MarkdownView from '@/components/MarkdownView'
import Button from '@/components/ui/Button'
import ErrorState from '@/components/ui/ErrorState'
import IconButton from '@/components/ui/IconButton'
import Skeleton from '@/components/ui/Skeleton'
import { api } from '@/lib/ipc'
import { errorText } from '@/lib/format'

interface Props {
  editId: string
  /** The explanation already stored with the change; when present nothing is fetched. */
  cached: string | null
  onClose: () => void
  /** Opens Settings, where a missing Anthropic API key is entered. */
  onOpenSettings?: () => void
}

/** Claude's explanation of one change. Shown only after the user asks; one call per change, kept for the session. */
export default function ExplainPanel({ editId, cached, onClose, onOpenSettings }: Props) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['explain', editId],
    queryFn: () => api.explainEdit(editId),
    initialData: cached ?? undefined,
    enabled: !cached,
    retry: false,
    staleTime: Infinity
  })

  return (
    <aside id="explain-panel" aria-label="Claude giải thích" className="flex h-explain shrink-0 flex-col border-t border-line bg-surface-1">
      <div className="flex h-9 shrink-0 items-center gap-2 px-3">
        <Sparkles aria-hidden size={14} className="text-accent-fg" />
        <h2 className="text-sm font-semibold">Claude giải thích</h2>
        <div className="flex-1" />
        <IconButton size="sm" variant="ghost" icon={X} label="Đóng giải thích" onClick={onClose} />
      </div>
      <div className="min-h-0 flex-1 animate-fade-in overflow-y-auto p-3">
        {isLoading && (
          <div role="status" className="flex flex-col gap-2 text-xs text-ink-muted">
            <span className="flex items-center gap-2">
              <Loader2 aria-hidden size={14} className="animate-spin" />
              Đang gọi Anthropic API…
            </span>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        )}
        {error && !isLoading && (
          <ErrorState
            variant="inline"
            title="Không lấy được giải thích"
            detail={errorText(error)}
            onRetry={() => void refetch()}
            extra={
              onOpenSettings && (
                <Button variant="ghost" size="sm" className="mt-1" onClick={onOpenSettings}>
                  Mở Cài đặt
                </Button>
              )
            }
          />
        )}
        {data && <MarkdownView markdown={data} headingLevel={3} />}
      </div>
    </aside>
  )
}
