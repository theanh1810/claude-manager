// Task progress of a change: the total, one disclosure per wave, the task rows (design brief PL2 "Tiến độ").
// Read only: the task boxes show state and take no click. The caller passes the `ok` state of tasks.md.

import clsx from 'clsx'
import { Check } from 'lucide-react'
import Disclosure from '@/components/ui/Disclosure'
import ProgressBar from '@/components/ui/ProgressBar'
import type { PlanTasksOk, PlanWave } from '@/types/spec'

function waveTitle(wave: number | null): string {
  return wave === null ? 'Chưa nhóm wave' : `Wave ${wave}`
}

function TaskRow({ id, title, done }: { id: string; title: string; done: boolean }) {
  return (
    <li className="flex items-start gap-2 px-3 py-1">
      <span
        className={clsx(
          'mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-sm border',
          done ? 'border-success-solid bg-success-solid text-accent-on' : 'border-line-control',
        )}
      >
        {done && <Check size={12} aria-hidden="true" />}
        <span className="sr-only">{done ? 'Đã xong' : 'Chưa xong'}</span>
      </span>
      <span className="font-mono text-xs text-ink-muted [overflow-wrap:anywhere]">{id}</span>
      <span className={clsx('min-w-0 text-sm [overflow-wrap:anywhere]', done && 'text-ink-muted')}>{title}</span>
    </li>
  )
}

function Wave({ wave }: { wave: PlanWave }) {
  // A finished wave starts closed; one with work left starts open.
  return (
    <li className="rounded-md border border-line">
      <Disclosure
        level={4}
        defaultOpen={wave.done < wave.total}
        title={waveTitle(wave.wave)}
        aside={<span className="tabular-nums">{wave.done}/{wave.total}</span>}
      >
        <ul className="flex flex-col pb-1">
          {wave.tasks.map((t, i) => (
            <TaskRow key={`${i}:${t.id}`} id={t.id} title={t.title} done={t.done} />
          ))}
        </ul>
      </Disclosure>
    </li>
  )
}

export default function TaskProgress({ tasks }: { tasks: PlanTasksOk }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="text-sm tabular-nums">{tasks.done}/{tasks.total} task xong</span>
        <div className="flex-1">
          <ProgressBar value={tasks.done} max={tasks.total} label="Tiến độ task" />
        </div>
      </div>
      <ul className="flex flex-col gap-2">
        {tasks.waves.map((w) => (
          <Wave key={w.wave ?? 'none'} wave={w} />
        ))}
      </ul>
    </div>
  )
}
