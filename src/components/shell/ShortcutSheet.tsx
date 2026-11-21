import Button, { Kbd } from '@/components/ui/Button'
import Dialog from '@/components/ui/Dialog'
import { keyLabels, type ShortcutKey } from '@/lib/platform'

interface Row {
  keys: ShortcutKey[]
  /** Joins several alternatives, e.g. `J` `K` hoặc `↑` `↓`. */
  or?: ShortcutKey[]
  label: string
}

const GROUPS: { title: string; note?: string; rows: Row[] }[] = [
  {
    title: 'Duyệt thay đổi',
    note: 'A và R chỉ hoạt động ở màn Chờ duyệt và khi bạn không đang gõ.',
    rows: [
      { keys: ['A'], label: 'Chấp nhận thay đổi đang chọn' },
      { keys: ['R'], label: 'Từ chối thay đổi đang chọn' },
      { keys: ['J', 'K'], or: ['↑', '↓'], label: 'Chọn thay đổi sau / trước' },
      { keys: ['Enter'], label: 'Chuyển vào vùng chi tiết' },
      { keys: ['/'], label: 'Tìm kiếm' }
    ]
  },
  {
    title: 'Điều hướng',
    rows: [
      { keys: ['mod', '1–6'], label: 'Chuyển giữa các màn hình' },
      { keys: ['mod', 'B'], label: 'Thu gọn hoặc mở rộng thanh bên' },
      { keys: ['mod', ','], label: 'Mở Cài đặt' },
      { keys: ['?'], label: 'Mở bảng phím tắt này' }
    ]
  },
  {
    title: 'Ghi nhận',
    rows: [
      { keys: ['mod', '.'], label: 'Tạm dừng hoặc tiếp tục ghi nhận' },
      { keys: ['mod', 'shift', 'L'], label: 'Bật hoặc tắt chế độ học' }
    ]
  }
]

function Chips({ keys }: { keys: ShortcutKey[] }) {
  return (
    <span className="inline-flex items-center gap-1">
      {keyLabels(keys).map((k, i) => (
        <Kbd key={i}>{k}</Kbd>
      ))}
    </span>
  )
}

interface Props {
  open: boolean
  onClose: () => void
}

/** The list of every shortcut, opened with `?`. Keys read as the platform writes them. */
export default function ShortcutSheet({ open, onClose }: Props) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Phím tắt"
      size="md"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Đóng
        </Button>
      }
    >
      <span className="sr-only">Danh sách phím tắt của claude-manager</span>
      <div className="flex flex-col gap-4">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h3 className="mb-2 text-sm font-semibold text-ink">{g.title}</h3>
            <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2">
              {g.rows.map((r) => (
                <div key={r.label} className="contents">
                  <dt className="flex items-center gap-1.5">
                    <Chips keys={r.keys} />
                    {r.or && (
                      <>
                        <span className="text-xs text-ink-subtle">hoặc</span>
                        <Chips keys={r.or} />
                      </>
                    )}
                  </dt>
                  <dd className="text-sm text-ink">{r.label}</dd>
                </div>
              ))}
            </dl>
            {g.note && <p className="mt-2 text-xs text-ink-subtle">{g.note}</p>}
          </section>
        ))}
      </div>
    </Dialog>
  )
}
