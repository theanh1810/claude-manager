// Review rounds, test rounds and the raw-file fallback of a change (design brief S2 "Review", "Test").
// Each takes one plan file section and renders its missing, ok and unreadable states; nothing here is editable.

import clsx from 'clsx'
import { AlertTriangle, FileText } from 'lucide-react'
import { useId } from 'react'
import MarkdownView from '@/components/MarkdownView'
import Banner from '@/components/ui/Banner'
import Disclosure from '@/components/ui/Disclosure'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import type { PlanErrorRound, PlanErrorsOk, PlanReviewOk, PlanReviewRound, PlanSection } from '@/types/spec'
import { VerdictMark } from './StatusMarks'

/** A fence one backtick longer than any run of backticks in the text, so the file cannot close it early. */
function fenced(text: string, lang: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return `${fence}${lang}\n${text}\n${fence}`
}

/** The plan file as written, under a notice that its summary could not be read. `name` is the file name. */
export function RawFallback({ name, raw }: { name: string; raw: string }) {
  const noticeId = useId()
  const shown = raw.trim() === '' ? null : name.endsWith('.yaml') ? fenced(raw, 'yaml') : raw
  return (
    <div className="flex flex-col gap-2">
      <Banner tone="warning" icon={AlertTriangle} role="region" aria-labelledby={noticeId}>
        <p id={noticeId}>Không đọc được tóm tắt {name}. Hiện nguyên file bên dưới.</p>
      </Banner>
      {shown !== null && <MarkdownView markdown={shown} headingLevel={4} />}
    </div>
  )
}

/** A plan file that could not be read at all; `message` is the reason, not file text. */
export function ReadError({ message }: { message: string }) {
  return <ErrorState variant="inline" title={`Không đọc được: ${message}`} />
}

function ReviewRound({ round }: { round: PlanReviewRound }) {
  return (
    <li className="rounded-md border border-line">
      <Disclosure level={4} title={`Vòng ${round.n} · ${round.kind}`}>
        <div className="px-3 pb-3">
          <MarkdownView markdown={round.markdown} headingLevel={5} />
        </div>
      </Disclosure>
    </li>
  )
}

export function ReviewRounds({ section }: { section: PlanSection<PlanReviewOk> }) {
  if (section.state === 'error') return <ReadError message={section.message} />
  if (section.state === 'unreadable') return <RawFallback name="review.md" raw={section.raw} />
  if (section.state === 'missing' || section.rounds.length === 0) {
    return <EmptyState variant="inline" icon={FileText} title="Chưa có vòng review nào" />
  }
  return (
    <ul className="flex flex-col gap-2">
      {section.rounds.map((r, i) => (
        <ReviewRound key={`${i}:${r.n}-${r.kind}`} round={r} />
      ))}
    </ul>
  )
}

function ErrorRoundRow({ round: r }: { round: PlanErrorRound }) {
  const none = r.critical === 0 && r.major === 0 && r.minor === 0
  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <span>Vòng {r.n}</span>{' '}
      <VerdictMark verdict={r.verdict} variant="full" />{' '}
      {none ? (
        <span>Không còn lỗi mở</span>
      ) : (
        <span className="tabular-nums">
          Mở:{' '}
          <span className={clsx(r.critical > 0 && 'font-medium text-danger-fg')}>{r.critical} nghiêm trọng</span>
          {' '}· {r.major} lớn · {r.minor} nhỏ
        </span>
      )}
    </li>
  )
}

export function ErrorRounds({ section }: { section: PlanSection<PlanErrorsOk> }) {
  if (section.state === 'error') return <ReadError message={section.message} />
  if (section.state === 'unreadable') return <RawFallback name="errors.yaml" raw={section.raw} />
  if (section.state === 'missing' || section.rounds.length === 0) {
    return <EmptyState variant="inline" icon={FileText} title="Chưa có vòng test nào" />
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {section.rounds.map((r, i) => (
        <ErrorRoundRow key={`${i}:${r.n}`} round={r} />
      ))}
    </ul>
  )
}
