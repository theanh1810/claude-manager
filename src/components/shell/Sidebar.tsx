import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { GraduationCap, PanelLeftClose, PanelLeftOpen, Pause, Settings, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import Button from '@/components/ui/Button'
import IconButton from '@/components/ui/IconButton'
import Switch from '@/components/ui/Switch'
import { useLearningToggle } from '@/hooks/useLearningToggle'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import type { NavCounts } from '@/hooks/useNavCounts'
import { api } from '@/lib/ipc'
import { NAV_GROUPS, type ScreenKey } from '@/lib/navigation'
import { shortcutText } from '@/lib/platform'
import ProjectSwitcher from './ProjectSwitcher'
import SidebarNavItem, { type NavItemCount } from './SidebarNavItem'

export type SidebarMode = 'full' | 'rail' | 'overlay'

const SIDEBAR_KEY = 'cm.sidebar'
const WIDE_QUERY = '(min-width:1100px)'

/**
 * From 1100px up the sidebar is full or a rail by the user's choice (kept in `cm.sidebar`);
 * below it is a rail that opens as an overlay, and opening it writes nothing.
 */
// eslint-disable-next-line react-refresh/only-export-components -- the hook and the sidebar it drives belong together
export function useSidebarMode(): { mode: SidebarMode; toggle: () => void; closeOverlay: () => void } {
  const wide = useMediaQuery(WIDE_QUERY)
  const [pref, setPref] = useState<'full' | 'rail'>(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === 'rail' ? 'rail' : 'full'
    } catch {
      return 'full'
    }
  })
  const [overlayOpen, setOverlayOpen] = useState(false)

  useEffect(() => {
    if (wide) setOverlayOpen(false)
  }, [wide])

  const toggle = useCallback(() => {
    if (!wide) {
      setOverlayOpen((open) => !open)
      return
    }
    const next = pref === 'full' ? 'rail' : 'full'
    setPref(next)
    try {
      localStorage.setItem(SIDEBAR_KEY, next)
    } catch {
      // Persistence is best effort; the choice still holds for this session.
    }
  }, [wide, pref])
  const closeOverlay = useCallback(() => setOverlayOpen(false), [])

  return { mode: wide ? pref : overlayOpen ? 'overlay' : 'rail', toggle, closeOverlay }
}

interface Props {
  mode: SidebarMode
  screen: ScreenKey
  counts: NavCounts
  activeProjectId: string | null
  onSelectScreen: (key: ScreenKey) => void
  onSelectProject: (id: string | null) => void
  onOpenSettings: () => void
  /** The collapse and expand button (and the overlay's close button). */
  onToggle: () => void
  onCloseOverlay: () => void
}

function countOf(counts: NavCounts, key: ScreenKey): NavItemCount | undefined {
  if (key === 'edits') return { status: counts.status, value: counts.pending, tone: 'warning' }
  if (key === 'history') return { status: counts.status, value: counts.history, tone: 'plain' }
  return undefined
}

export default function Sidebar({ mode, screen, counts, activeProjectId, onSelectScreen, onSelectProject, onOpenSettings, onToggle, onCloseOverlay }: Props) {
  const rail = mode === 'rail'
  const overlay = mode === 'overlay'
  const asideRef = useRef<HTMLElement>(null)
  const qc = useQueryClient()
  const learning = useLearningToggle()

  const settings = useQuery({ queryKey: ['settings'], queryFn: api.getSettings, staleTime: 5000 })
  const paused = settings.data?.paused ?? false
  const togglePause = useMutation({
    mutationFn: api.togglePause,
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ['settings'] })
      const prev = qc.getQueryData<typeof settings.data>(['settings'])
      if (prev) qc.setQueryData(['settings'], { ...prev, paused: !prev.paused })
      return { prev }
    },
    onError: (_, __, ctx) => {
      if (ctx?.prev) qc.setQueryData(['settings'], ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['settings'] })
  })

  useEffect(() => {
    if (!overlay) return
    asideRef.current?.querySelector<HTMLElement>('button')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseOverlay()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [overlay, onCloseOverlay])

  const select = (key: ScreenKey) => {
    onSelectScreen(key)
    if (overlay) onCloseOverlay()
  }

  const pauseState = settings.isPending ? 'Đang tải…' : settings.isError ? 'Không đọc được cài đặt' : paused ? 'Đã tạm dừng — không ghi thay đổi mới' : 'Đang ghi nhận'
  const learningState = learning.enabled ? 'Bật — agent thêm mục “Học được gì”' : 'Tắt'
  const switchOff = settings.isError
  const collapseShortcut = shortcutText(['mod', 'B'])

  return (
    <div className={clsx('relative h-full shrink-0', mode === 'full' ? 'w-sidebar' : 'w-rail')}>
      {overlay && <div data-scrim aria-hidden="true" onClick={onCloseOverlay} className="fixed inset-0 z-overlay animate-fade-in bg-scrim" />}
      <aside
        ref={asideRef}
        className={clsx(
          'flex h-full flex-col border-r border-line bg-surface-1',
          overlay ? 'fixed left-0 top-0 z-overlay w-sidebar animate-slide-in-left' : 'w-full'
        )}
      >
        <div className={clsx('flex h-header shrink-0 items-center', rail ? 'justify-center' : 'gap-2 px-3')}>
          {rail ? (
            <IconButton label="Mở rộng thanh bên" icon={PanelLeftOpen} shortcut={collapseShortcut} onClick={onToggle} />
          ) : (
            <>
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-accent text-accent-on">
                <Sparkles aria-hidden size={14} />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">claude-manager</span>
              <IconButton label="Thu gọn thanh bên" icon={PanelLeftClose} size="sm" shortcut={collapseShortcut} onClick={onToggle} />
            </>
          )}
        </div>

        <div className={clsx('shrink-0 pb-2', rail ? 'flex justify-center' : 'px-2')}>
          <ProjectSwitcher activeProjectId={activeProjectId} onSelect={onSelectProject} rail={rail} />
        </div>

        <nav aria-label="Điều hướng chính" className={clsx('min-h-0 flex-1 overflow-y-auto', rail ? 'flex flex-col items-center px-2' : 'px-2')}>
          {NAV_GROUPS.map((g, i) => {
            const labelId = `nav-group-${i}`
            return (
              <div key={g.label} role="group" aria-labelledby={labelId}>
                {rail && i > 0 && <div aria-hidden="true" className="my-2 border-t border-line" />}
                <div id={labelId} className={clsx(rail ? 'sr-only' : 'flex h-6 items-center px-2 text-xs text-ink-subtle')}>
                  {g.label}
                </div>
                <ul className="flex flex-col gap-0.5">
                  {g.screens.map((s) => (
                    <SidebarNavItem key={s.key} screen={s} active={s.key === screen} rail={rail} count={countOf(counts, s.key)} onSelect={select} />
                  ))}
                </ul>
              </div>
            )
          })}
        </nav>

        <div className={clsx('shrink-0 border-t border-line py-2', rail ? 'flex flex-col items-center gap-1 px-2' : 'px-2')}>
          {rail ? (
            <>
              <Switch layout="icon" icon={Pause} label="Tạm dừng ghi nhận" checked={paused} loading={settings.isPending} disabled={switchOff} onCheckedChange={() => togglePause.mutate()} />
              <Switch layout="icon" icon={GraduationCap} label="Chế độ học" checked={learning.enabled} onCheckedChange={learning.toggle} />
              <IconButton label="Cài đặt" icon={Settings} size="rail" shortcut={shortcutText(['mod', ','])} onClick={onOpenSettings} />
            </>
          ) : (
            <>
              <div className="flex h-[52px] items-center">
                <Switch label="Tạm dừng ghi nhận" description={pauseState} checked={paused} loading={settings.isPending} disabled={switchOff} onCheckedChange={() => togglePause.mutate()} />
                {settings.isError && (
                  <Button variant="ghost" size="sm" onClick={() => void settings.refetch()}>
                    Thử lại
                  </Button>
                )}
              </div>
              <div className="flex h-[52px] items-center">
                <Switch label="Chế độ học" description={learningState} checked={learning.enabled} onCheckedChange={learning.toggle} />
              </div>
              <button type="button" onClick={onOpenSettings} className="focus-inset flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm text-ink-muted hover:bg-surface-2 hover:text-ink">
                <Settings aria-hidden size={16} strokeWidth={1.75} />
                <span className="flex-1 text-left">Cài đặt</span>
                <span className="text-xs text-ink-subtle">{shortcutText(['mod', ','])}</span>
              </button>
            </>
          )}
        </div>
      </aside>
    </div>
  )
}
