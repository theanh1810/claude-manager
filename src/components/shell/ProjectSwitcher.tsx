import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import clsx from 'clsx'
import { ChevronsUpDown, Globe, Loader2, Plus, RotateCw, Trash2, type LucideIcon } from 'lucide-react'
import Menu, { type MenuItem } from '@/components/ui/Menu'
import Skeleton from '@/components/ui/Skeleton'
import Tooltip from '@/components/ui/Tooltip'
import { useConfirm } from '@/components/ui/ConfirmProvider'
import { api } from '@/lib/ipc'
import { errorText } from '@/lib/format'
import { pickProjectColor } from '@/lib/projectColors'
import { useNoticeStore } from '@/stores/useNoticeStore'

interface Props {
  activeProjectId: string | null
  onSelect: (id: string | null) => void
  rail: boolean
}

/** The menu items take a LucideIcon; a project shows its colour dot through the same slot. One component per colour keeps its identity stable. */
const dotIcons = new Map<string, LucideIcon>()
function dotIcon(color: string | null): LucideIcon {
  const key = color ?? ''
  let icon = dotIcons.get(key)
  if (!icon) {
    const Dot = ({ className }: { className?: string }) => (
      <span aria-hidden="true" className={clsx('inline-block size-2 rounded-full', !color && 'bg-ink-subtle', className)} style={color ? { backgroundColor: color } : undefined} />
    )
    icon = Dot as unknown as LucideIcon
    dotIcons.set(key, icon)
  }
  return icon
}

/** The project menu at the top of the sidebar: Tất cả or one project, add one, stop following one. */
export default function ProjectSwitcher({ activeProjectId, onSelect, rail }: Props) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const notify = useNoticeStore((s) => s.notify)
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.listProjects, staleTime: 30_000 })
  const list = projects.data ?? []
  const active = list.find((p) => p.id === activeProjectId) ?? null

  const addProject = useMutation({
    mutationFn: async () => {
      const dir = await openDialog({ directory: true, multiple: false, title: 'Chọn folder project để theo dõi' })
      if (!dir) return null
      return api.addProject(dir as string, undefined, pickProjectColor())
    },
    onSuccess: (p) => {
      if (!p) return
      void qc.invalidateQueries({ queryKey: ['projects'] })
      onSelect(p.id)
    },
    onError: (e) => notify({ id: 'project-add', tone: 'danger', children: `Không thêm được project: ${errorText(e)}` })
  })

  const removeProject = useMutation({
    mutationFn: (id: string) => api.removeProject(id),
    onSuccess: (_, id) => {
      void qc.invalidateQueries({ queryKey: ['projects'] })
      if (activeProjectId === id) onSelect(null)
    },
    onError: (e) => notify({ id: 'project-remove', tone: 'danger', children: `Không bỏ theo dõi được project: ${errorText(e)}` })
  })

  const askRemove = async (id: string, name: string) => {
    const ok = await confirm({
      title: `Bỏ theo dõi project "${name}"?`,
      description: 'Các thay đổi đã ghi nhận vẫn được giữ.',
      confirmLabel: 'Bỏ theo dõi',
      tone: 'danger'
    })
    if (ok) removeProject.mutate(id)
  }

  const items: MenuItem[] = [
    { id: 'all', label: 'Tất cả', icon: Globe, checked: active === null, onSelect: () => onSelect(null) },
    ...list.map<MenuItem>((p) => ({
      id: p.id,
      label: p.name,
      icon: dotIcon(p.color),
      checked: p.id === active?.id,
      onSelect: () => {
        onSelect(p.id)
        // Recency bookkeeping only: a failed touch changes nothing the user sees.
        api.touchProject(p.id).catch(() => {})
      }
    })),
    ...(projects.isError ? [{ id: 'retry', label: 'Thử lại tải project', icon: RotateCw, onSelect: () => void projects.refetch() }] : []),
    {
      id: 'add',
      label: 'Thêm project…',
      icon: addProject.isPending ? Loader2 : Plus,
      disabled: addProject.isPending,
      separatorBefore: true,
      onSelect: () => addProject.mutate()
    },
    ...(active ? [{ id: 'remove', label: `Bỏ theo dõi project "${active.name}"…`, icon: Trash2, onSelect: () => void askRemove(active.id, active.name) }] : [])
  ]

  const name = projects.isError ? 'Không tải được project' : (active?.name ?? 'Tất cả')
  const dot = active ? dotIcon(active.color) : Globe
  const Dot = dot

  return (
    <Menu
      label="Project"
      items={items}
      side={rail ? 'right' : 'bottom'}
      className={rail ? undefined : 'block w-full'}
      renderTrigger={(p) =>
        rail ? (
          <Tooltip content={name} side="right">
            <button {...p} type="button" aria-label={`Project ${name}`} className="focus-inset flex size-10 items-center justify-center rounded-md border border-line bg-surface-0 text-ink-muted hover:bg-surface-2">
              <Dot aria-hidden size={14} />
            </button>
          </Tooltip>
        ) : (
          <button {...p} type="button" className="focus-inset flex h-11 w-full items-center gap-2 rounded-md border border-line bg-surface-0 px-2 text-left hover:bg-surface-2">
            <Dot aria-hidden size={14} className="shrink-0 text-ink-muted" />
            <span className="min-w-0 flex-1">
              <span className="block text-xs text-ink-subtle">Project</span>
              {projects.isPending ? (
                <Skeleton className="h-4 w-24" />
              ) : (
                <span className={clsx('block truncate text-sm font-medium', projects.isError ? 'text-danger-fg' : 'text-ink')}>{name}</span>
              )}
            </span>
            <ChevronsUpDown aria-hidden size={14} className="shrink-0 text-ink-subtle" />
          </button>
        )
      }
    />
  )
}
