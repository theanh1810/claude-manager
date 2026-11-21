import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Activity, Clock, Info, KeyRound, Power, type LucideIcon } from 'lucide-react'
import { useEffect, useId, useState, type ReactNode } from 'react'
import Button from '@/components/ui/Button'
import Checkbox from '@/components/ui/Checkbox'
import Dialog from '@/components/ui/Dialog'
import ErrorState from '@/components/ui/ErrorState'
import Input from '@/components/ui/Input'
import Skeleton from '@/components/ui/Skeleton'
import { errorText } from '@/lib/format'
import { api } from '@/lib/ipc'
import type { Settings } from '@/types/edit'

interface Props {
  onClose: () => void
}

type Status = { kind: 'saved' } | { kind: 'error'; text: string }

const SAVED_MS = 2000

export default function SettingsModal({ onClose }: Props) {
  const qc = useQueryClient()
  const [status, setStatus] = useState<Status | null>(null)
  const [autostartBusy, setAutostartBusy] = useState(false)

  const { data: settings, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ['settings'],
    queryFn: api.getSettings,
    staleTime: 5000
  })
  // The system's own answer; the stored flag is only the fallback while it is unknown.
  const autostart = useQuery({ queryKey: ['autostart'], queryFn: api.autostartIsEnabled, staleTime: 0, retry: false })
  const version = useQuery({ queryKey: ['app-version'], queryFn: api.appVersion, staleTime: Infinity, retry: false })

  const update = useMutation({
    mutationFn: (patch: Partial<Settings>) => api.updateSettings(patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ['settings'] })
      const prev = qc.getQueryData<Settings>(['settings'])
      if (prev) qc.setQueryData(['settings'], { ...prev, ...patch })
      return { prev }
    },
    onError: (_, __, ctx) => {
      if (ctx?.prev) qc.setQueryData(['settings'], ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['settings'] })
  })

  useEffect(() => {
    if (status?.kind !== 'saved') return
    const t = window.setTimeout(() => setStatus(null), SAVED_MS)
    return () => window.clearTimeout(t)
  }, [status])

  // mutateAsync, not mutate with callbacks: one observer keeps one set of per-call callbacks, so a
  // later save (the autostart switch) would detach this one and drop its status line.
  const save = async (patch: Partial<Settings>) => {
    try {
      await update.mutateAsync(patch)
      setStatus({ kind: 'saved' })
    } catch (e) {
      setStatus({ kind: 'error', text: `Không lưu được: ${errorText(e)}` })
    }
  }

  const setAutostart = async (on: boolean) => {
    const apply = (to: boolean) => (to ? api.autostartEnable() : api.autostartDisable())
    setAutostartBusy(true)
    try {
      // The system first: the flag is stored only once the login item really changed.
      await apply(on)
      try {
        await update.mutateAsync({ autostart: on })
        qc.setQueryData(['autostart'], on)
        setStatus({ kind: 'saved' })
      } catch (e) {
        await apply(!on).catch(() => undefined)
        void qc.invalidateQueries({ queryKey: ['autostart'] })
        setStatus({ kind: 'error', text: `Không lưu được: ${errorText(e)}` })
      }
    } catch (e) {
      setStatus({ kind: 'error', text: `Không lưu được: ${errorText(e)}` })
    } finally {
      setAutostartBusy(false)
    }
  }

  return (
    <Dialog
      open
      size="lg"
      title="Cài đặt"
      onClose={onClose}
      footer={
        <>
          <p
            aria-live="polite"
            className={clsx('mr-auto flex min-h-4 items-center text-xs', status?.kind === 'error' ? 'text-danger-fg' : 'text-success-fg')}
          >
            {status?.kind === 'saved' ? 'Đã lưu' : status?.text}
          </p>
          <Button variant="secondary" onClick={onClose}>
            Đóng
          </Button>
        </>
      }
    >
      {isError ? (
        <ErrorState
          variant="inline"
          title="Không đọc được cài đặt"
          detail={errorText(error)}
          onRetry={() => void refetch()}
          retrying={isRefetching}
        />
      ) : !settings ? (
        <div className="flex flex-col gap-6">
          <Skeleton.Rows count={6} height={56} />
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <Section title="Ghi nhận" icon={Activity} first>
            <Row description="Claude vẫn sửa file bình thường. App không ghi nhận thay đổi cho đến khi bạn bật lại.">
              {(describedBy) => (
                <Checkbox
                  label="Tạm dừng ghi nhận"
                  aria-describedby={describedBy}
                  checked={settings.paused}
                  onChange={(e) => void save({ paused: e.target.checked })}
                />
              )}
            </Row>
          </Section>

          <Section title="Lưu giữ" icon={Clock}>
            <Input
              className="w-40"
              type="number"
              label="Số ngày lưu snapshot"
              hint="Tự xoá snapshot cũ hơn N ngày."
              min={1}
              step={1}
              defaultValue={settings.retention_days}
              onBlur={(e) => {
                const raw = e.target.value.trim()
                const v = Number(raw)
                // The backend stores any JSON value but reads an i64: only a safe whole number from 1 may go in.
                if (raw === '' || !Number.isSafeInteger(v) || v < 1) {
                  e.target.value = String(settings.retention_days)
                  setStatus({ kind: 'error', text: 'Không lưu được: số ngày phải là số nguyên từ 1 trở lên' })
                  return
                }
                if (v !== settings.retention_days) void save({ retention_days: v })
              }}
            />
          </Section>

          <Section title="Khởi động" icon={Power}>
            <Row description="Đăng ký mục khởi động cùng hệ điều hành (macOS: login item; Windows: autostart). Cần khởi động lại máy để có hiệu lực.">
              {(describedBy) => (
                <Checkbox
                  label="Khởi động cùng máy"
                  aria-describedby={describedBy}
                  checked={autostart.data ?? settings.autostart}
                  disabled={autostartBusy}
                  onChange={(e) => void setAutostart(e.target.checked)}
                />
              )}
            </Row>
          </Section>

          <Section title="Anthropic API" icon={KeyRound}>
            <Input
              type="password"
              label="Anthropic API key"
              placeholder="sk-ant-..."
              hint="Key lưu trên máy. Chỉ gửi tới Anthropic khi bạn bấm “Giải thích”. Tự lưu khi bạn rời khỏi ô nhập."
              defaultValue={settings.anthropic_api_key}
              onBlur={(e) => {
                if (e.target.value !== settings.anthropic_api_key) void save({ anthropic_api_key: e.target.value })
              }}
            />
          </Section>

          <Section title="mem0 API" icon={KeyRound}>
            <Input
              type="password"
              label="mem0 API key"
              placeholder="mem0 API key"
              hint="Key lưu trên máy. Chỉ dùng để đọc memory từ mem0 ở màn Memory & lỗi. Tự lưu khi bạn rời khỏi ô nhập."
              defaultValue={settings.mem0_api_key ?? ''}
              onBlur={(e) => {
                if (e.target.value !== (settings.mem0_api_key ?? '')) void save({ mem0_api_key: e.target.value })
              }}
            />
          </Section>

          <Section title="Về ứng dụng" icon={Info}>
            {version.data && (
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-ink-muted">Phiên bản</span>
                <span className="tabular-nums">claude-manager v{version.data}</span>
              </div>
            )}
          </Section>
        </div>
      )}
    </Dialog>
  )
}

function Section({ title, icon: Icon, first = false, children }: { title: string; icon: LucideIcon; first?: boolean; children: ReactNode }) {
  return (
    <section className={clsx('flex flex-col gap-3', !first && 'border-t border-line pt-6')}>
      <h3 className="m-0 flex items-center gap-2 text-sm font-semibold">
        <Icon aria-hidden size={16} className="text-ink-muted" />
        {title}
      </h3>
      {children}
    </section>
  )
}

/** The framed control row: the control, then its explanation tied to it for assistive tech. */
function Row({ description, children }: { description: string; children: (describedBy: string) => ReactNode }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1 rounded-md border border-line bg-surface-1 p-3">
      {children(id)}
      <p id={id} className="pl-6 text-xs text-ink-muted">
        {description}
      </p>
    </div>
  )
}
