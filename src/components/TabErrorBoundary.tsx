// TabErrorBoundary — keeps one broken tab from blanking the whole app.
//
// Found by the app-level smoke (src/__tests__/appSmoke.test.tsx): a
// component that threw during render — `ExportSizePreview` reading
// `file_count` off an unexpected IPC payload — unmounted the entire React
// tree, leaving an empty `<body><div /></body>`. React does that by design
// when nothing catches the error, and the app had no boundary anywhere.
//
// A class component is required: `componentDidCatch` / `getDerivedStateFromError`
// have no hook equivalent (React docs, "Catching rendering errors with an
// error boundary").
//
// Scope is per screen, keyed by the caller on the active screen, so switching
// away and back retries a failed screen; "Tải lại màn này" retries it in place.

import { Component, type ErrorInfo, type ReactNode } from 'react'
import ErrorState from '@/components/ui/ErrorState'

interface Props {
  /** The screen's Vietnamese name, shown in the fallback so the user knows which one failed. */
  label: string
  children: ReactNode
  /** Called before the boundary clears, so the caller can drop cached data the screen crashed on. */
  onReload?: () => void
}

interface State {
  error: Error | null
}

export default class TabErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the stack in the console for debugging; the UI shows only the
    // message, which is what a user can act on.
    console.error(`Tab "${this.props.label}" crashed:`, error, info.componentStack)
  }

  reload = () => {
    this.props.onReload?.()
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="min-w-0 flex-1 p-6" data-testid="tab-error">
        <div className="max-w-[520px]">
          <ErrorState
            variant="inline"
            title={`Màn “${this.props.label}” gặp lỗi và đã dừng hiển thị`}
            detail={error.message}
            extra={
              <p className="mt-1 text-xs text-ink-muted">
                Các màn khác vẫn dùng được. Chuyển sang màn khác rồi quay lại để thử tải lại.
              </p>
            }
            retryLabel="Tải lại màn này"
            onRetry={this.reload}
          />
        </div>
      </div>
    )
  }
}
