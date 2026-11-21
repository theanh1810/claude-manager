import { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense, type ReactNode } from 'react'
import { listen } from '@tauri-apps/api/event'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { Lock } from 'lucide-react'
import EditListPanel from './features/edits/EditListPanel'
import EditDetailPanel from './features/edits/EditDetailPanel'
import { useEditDecision, type DecisionCallbacks } from './features/edits/useEditDecision'
import TabErrorBoundary from './components/TabErrorBoundary'
import BulkActionBar from './components/BulkActionBar'
import Sidebar, { useSidebarMode } from './components/shell/Sidebar'
import ScreenHeader from './components/shell/ScreenHeader'
import ScreenSkeleton from './components/shell/ScreenSkeleton'
import ShortcutSheet from './components/shell/ShortcutSheet'
import SkipLink from './components/shell/SkipLink'
import Badge from './components/ui/Badge'
import NoticeHost from './components/ui/NoticeHost'
import { api } from './lib/ipc'
import { screenByKey, screenForShortcut, type ScreenKey } from './lib/navigation'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useLearningToggle, useLearningSync } from './hooks/useLearningToggle'
import { useNavCounts } from './hooks/useNavCounts'
import { useReviewFilterStore } from './stores/useReviewFilterStore'

// Every screen but the two review lists is a route-level surface that is never needed on first
// paint. Plans owns the markdown renderer (react-markdown + remark-gfm, with the lazy Prism chunk
// behind them), so loading it lazily keeps that weight out of the initial chunk.
const SessionsPage = lazy(() => import('./features/sessions/SessionsPage'))
const MemoryTab = lazy(() => import('./features/memory/MemoryTab'))
const PlansTab = lazy(() => import('./features/plans/PlansTab'))
const CleanupPanel = lazy(() => import('./features/sessions/CleanupPanel'))
const SettingsModal = lazy(() => import('./features/settings/SettingsModal'))

const ACTIVE_PROJECT_KEY = 'cm.activeProject'

const SESSIONS_SUBTITLE = 'Session của Claude Code theo project — không hiển thị nội dung hội thoại.'
const CLEANUP_SUBTITLE = 'Dọn dẹp lưu trữ thừa trong ~/.claude'

/** The review layout: the 320px list pane and the detail area, side by side under the screen header. */
function ReviewPane({ list, detail }: { list: ReactNode; detail: ReactNode }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex w-pane shrink-0 select-none flex-col overflow-hidden border-r border-line bg-surface-0">{list}</div>
      <section className="min-w-0 flex-1 overflow-hidden bg-surface-0">{detail}</section>
    </div>
  )
}

/** Query roots each screen's own components read, reset when its crash card is reloaded.
 *  Never `projects`, `settings`, `autostart` or `app-version`: those belong to the shell. */
const SCREEN_QUERY_ROOTS: Record<ScreenKey, string[]> = {
  edits: ['edits', 'edit', 'edit-diff', 'explain'],
  history: ['edits', 'edit', 'edit-diff', 'explain'],
  sessions: ['sessions', 'sessions-index'],
  cleanup: ['cleanup'],
  plans: ['plans'],
  memory: ['memory']
}

export default function App() {
  const [screen, setScreen] = useState<ScreenKey>('edits')
  const [activeProjectId, setActiveProjectId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(ACTIVE_PROJECT_KEY)
    } catch {
      return null
    }
  })
  const [selectedEditId, setSelectedEditId] = useState<string | null>(null)
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const qc = useQueryClient()
  const debounceRef = useRef<number | null>(null)
  const sidebar = useSidebarMode()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const focusHeadingNext = useRef(false)

  useEffect(() => {
    try {
      if (activeProjectId) localStorage.setItem(ACTIVE_PROJECT_KEY, activeProjectId)
      else localStorage.removeItem(ACTIVE_PROJECT_KEY)
    } catch {
      // Quota/SecurityError from localStorage is non-fatal — UI state still
      // works in-memory, persistence just degrades silently for this session.
    }
  }, [activeProjectId])

  useEffect(() => {
    const un = listen('edits-changed', () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
      debounceRef.current = window.setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['edits'] })
      }, 250)
    })
    return () => {
      un.then((f) => f())
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
    }
  }, [qc])

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: api.listProjects,
    staleTime: 30_000
  })

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId]
  )
  const projectPath = activeProject?.path ?? null

  // The one pending-count rule (useNavCounts): the sidebar, the subtitles and the lists below read it.
  const counts = useNavCounts(projectPath)
  const pendingEdits = counts.pendingEdits

  useEffect(() => {
    if (!selectedEditId) return
    const stillPending = pendingEdits.find((e) => e.id === selectedEditId)
    if (!stillPending) {
      const next = pendingEdits[0]?.id ?? null
      setSelectedEditId(next)
    }
  }, [pendingEdits, selectedEditId])

  // Reset selection when switching project
  useEffect(() => {
    setSelectedEditId(null)
    setSelectedHistoryId(null)
  }, [activeProjectId])

  // Same toggle the sidebar switch uses — one path for store write +
  // persist + broadcast (see useLearningToggle).
  const learning = useLearningToggle()
  // Keeps the cached flag reconciled with the DB (the owner).
  useLearningSync()
  const advanceToNext = useCallback(() => {
    const idx = pendingEdits.findIndex((e) => e.id === selectedEditId)
    const next = pendingEdits[idx + 1] ?? pendingEdits[0]
    setSelectedEditId(next && next.id !== selectedEditId ? next.id : null)
  }, [pendingEdits, selectedEditId])

  // The keys share the buttons' decision path (useEditDecision): the same
  // error line in the detail panel, the same advance, and one in-flight guard.
  const decisionId = screen === 'edits' ? selectedEditId : null
  const decision = useEditDecision(decisionId, advanceToNext)
  const canDecide =
    decisionId !== null &&
    !decision.busy &&
    pendingEdits.some((e) => e.id === decisionId)

  // A/R stay locked from the key press until the refresh resolved and the
  // next change is selected, so a quick second press cannot hit the wrong one.
  const keyLock = useRef(false)
  const [keyLocked, setKeyLocked] = useState(false)
  const [keySettled, setKeySettled] = useState(false)
  useEffect(() => {
    if (keyLock.current && keySettled) {
      keyLock.current = false
      setKeyLocked(false)
      setKeySettled(false)
    }
  }, [selectedEditId, keySettled])
  useEffect(
    () => () => {
      keyLock.current = false
    },
    []
  )
  // Read at key time: App subscribes to neither detail query, so a render-time value would go stale.
  // Placeholder data is never stored under the new key, so this is false while the previous diff shows.
  const detailReady = (id: string) => {
    const diffState = qc.getQueryState(['edit-diff', id])
    return (
      qc.getQueryState(['edit', id])?.data !== undefined &&
      (diffState?.data !== undefined || diffState?.status === 'error')
    )
  }
  const decideByKey = (run: (cb: DecisionCallbacks) => void) => {
    if (!canDecide || decisionId === null || !detailReady(decisionId) || keyLock.current) return false
    keyLock.current = true
    setKeyLocked(true)
    setKeySettled(false)
    run({
      onDone: () => setKeySettled(true),
      onError: () => {
        keyLock.current = false
        setKeyLocked(false)
      }
    })
    return true
  }

  // A screen change moves focus to the new h1; the first opening of the app does not.
  const goTo = (key: ScreenKey) => {
    if (key === screen) {
      headingRef.current?.focus()
      return
    }
    focusHeadingNext.current = true
    setScreen(key)
  }
  useEffect(() => {
    if (!focusHeadingNext.current) return
    focusHeadingNext.current = false
    headingRef.current?.focus()
  }, [screen])

  // j and k press Down and Up on the primary list of the screen, so the list's own keys stay the one path.
  const pressOnList = (key: 'ArrowDown' | 'ArrowUp') => {
    const list = document.querySelector<HTMLElement>('[data-primary-list]')
    if (!list) return false
    list.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    return true
  }

  useKeyboardShortcuts({
    onAccept: () => decideByKey(decision.accept),
    onReject: () => decideByKey(decision.reject),
    onSettings: () => {
      setSettingsOpen(true)
      return true
    },
    onPause: () => {
      void api.togglePause().then(() => qc.invalidateQueries({ queryKey: ['settings'] }))
      return true
    },
    onLearning: () => {
      learning.toggle()
      return true
    },
    onScreen: (n) => {
      const target = screenForShortcut(n)
      if (!target) return false
      goTo(target.key)
      return true
    },
    onSidebar: () => {
      sidebar.toggle()
      return true
    },
    onHelp: () => {
      setHelpOpen(true)
      return true
    },
    onSearch: () => {
      const search = document.querySelector<HTMLElement>('[data-primary-search]')
      search?.focus()
      return search !== null
    },
    onNext: () => pressOnList('ArrowDown'),
    onPrev: () => pressOnList('ArrowUp'),
    enabled: !settingsOpen,
    locked: keyLocked
  })

  // "Xem thay đổi": the session filter is already set by the Sessions screen.
  // Open Pending when the session has a pending change, else History.
  const openSession = (_sessionId: string, hasPending: boolean) => {
    goTo(hasPending ? 'edits' : 'history')
  }

  const filtering = useReviewFilterStore((s) => s.claudeOnly.pending || s.sessionId !== null)
  const scope = activeProject ? `project "${activeProject.name}"` : 'tất cả project'
  const subtitle = (() => {
    switch (screen) {
      case 'edits':
        if (counts.status === 'loading') return 'Đang tải…'
        if (counts.status === 'error') return 'Không tải được số lượng'
        return `${counts.pending} thay đổi chờ duyệt · ${scope}${filtering ? ' · Đang lọc — bỏ bộ lọc để duyệt hàng loạt' : ''}`
      case 'history':
        if (counts.status === 'loading') return 'Đang tải…'
        if (counts.status === 'error') return 'Không tải được số lượng'
        return `${counts.history} thay đổi đã xử lý · ${scope}`
      case 'sessions':
        return SESSIONS_SUBTITLE
      case 'cleanup':
        return CLEANUP_SUBTITLE
      default:
        return scope
    }
  })()
  const current = screenByKey(screen)

  return (
    <div className="grid h-screen grid-cols-[auto_minmax(0,1fr)] overflow-hidden bg-surface-0 text-ink">
      <SkipLink />
      <Sidebar
        mode={sidebar.mode}
        screen={screen}
        counts={counts}
        activeProjectId={activeProjectId}
        onSelectScreen={goTo}
        onSelectProject={setActiveProjectId}
        onOpenSettings={() => setSettingsOpen(true)}
        onToggle={sidebar.toggle}
        onCloseOverlay={sidebar.closeOverlay}
      />

      <main id="main" tabIndex={-1} className="relative flex min-h-0 min-w-0 flex-col outline-none">
        <ScreenHeader
          title={current.title}
          subtitle={subtitle}
          headingRef={headingRef}
          actions={
            screen === 'edits' ? (
              <BulkActionBar pendingCount={counts.pending ?? 0} projectPath={projectPath} projectName={activeProject?.name ?? null} />
            ) : screen === 'memory' ? (
              <Badge tone="neutral" icon={Lock}>Chỉ đọc</Badge>
            ) : undefined
          }
        />
        <NoticeHost />
        {/* Keyed on `screen` so a crashed screen retries when the user comes back to it, and so every
            screen unmounts when left: UC-001/AC-14 reads session history on each opening. Without
            the boundary a single throwing component unmounts the whole app — see TabErrorBoundary. */}
        <div key={screen} className="flex min-h-0 flex-1 animate-enter-rise gap-px bg-line">
          <TabErrorBoundary
            label={current.title}
            onReload={() => {
              for (const root of SCREEN_QUERY_ROOTS[screen]) void qc.resetQueries({ queryKey: [root] })
            }}
          >
            {screen === 'edits' && (
              <ReviewPane
                list={
                  <EditListPanel
                    selectedId={selectedEditId}
                    onSelect={setSelectedEditId}
                    showHistory={false}
                    projectPath={projectPath}
                    locked={keyLocked}
                  />
                }
                detail={
                  <EditDetailPanel
                    editId={selectedEditId}
                    onAfterDecision={advanceToNext}
                    decisionKeys
                    onOpenSettings={() => setSettingsOpen(true)}
                  />
                }
              />
            )}
            {screen === 'history' && (
              <ReviewPane
                list={<EditListPanel selectedId={selectedHistoryId} onSelect={setSelectedHistoryId} showHistory projectPath={projectPath} />}
                detail={<EditDetailPanel editId={selectedHistoryId} onOpenSettings={() => setSettingsOpen(true)} />}
              />
            )}
            {/* One Suspense per screen: the fallback fills the slot the screen will occupy, so the
                frame does not reflow when the chunk lands. */}
            {screen === 'sessions' && (
              <Suspense fallback={<ScreenSkeleton screen="sessions" withHeader={false} />}>
                <section className="flex-1 min-w-0 overflow-hidden bg-surface-0">
                  <SessionsPage project={projectPath} onNavigate={openSession} />
                </section>
              </Suspense>
            )}
            {screen === 'cleanup' && (
              <Suspense fallback={<ScreenSkeleton screen="cleanup" withHeader={false} />}>
                <section className="flex-1 min-w-0 overflow-hidden bg-surface-0">
                  <CleanupPanel />
                </section>
              </Suspense>
            )}
            {screen === 'plans' && (
              <Suspense fallback={<ScreenSkeleton screen="plans" withHeader={false} />}>
                <PlansTab project={projectPath} />
              </Suspense>
            )}
            {screen === 'memory' && (
              <Suspense fallback={<ScreenSkeleton screen="memory" withHeader={false} />}>
                <MemoryTab project={projectPath} onOpenSettings={() => setSettingsOpen(true)} />
              </Suspense>
            )}
          </TabErrorBoundary>
        </div>
      </main>

      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsModal onClose={() => setSettingsOpen(false)} />
        </Suspense>
      )}
      <ShortcutSheet open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  )
}
