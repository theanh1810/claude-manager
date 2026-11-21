import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'
import SettingsModal from '../SettingsModal'

vi.mock('focus-trap-react', () => ({ default: ({ children }: { children: React.ReactNode }) => children }))
const invokeMock = vi.mocked(invoke)

const SETTINGS = {
  paused: false, retention_days: 30, anthropic_api_key: '', mem0_api_key: null,
  explain_model: 'claude-opus-5-5', autostart: false, learning: false,
}

interface Wiring {
  updateFails?: boolean
  /** Per plugin command: a rejection message. */
  plugin?: Partial<Record<'enable' | 'disable' | 'is_enabled' | 'version', string>>
  enabled?: boolean
  version?: string
  settings?: Promise<typeof SETTINGS> | Error
}

function wire(w: Wiring = {}) {
  invokeMock.mockImplementation((cmd: string, args?: unknown) => {
    if (cmd === 'get_settings') {
      if (w.settings instanceof Error) return Promise.reject(w.settings)
      return w.settings ?? Promise.resolve(SETTINGS)
    }
    if (cmd === 'update_settings') {
      return w.updateFails ? Promise.reject(new Error('no')) : Promise.resolve({ ...SETTINGS, ...(args as { patch: object }).patch })
    }
    const m = /^plugin:(autostart|app)\|(\w+)$/.exec(cmd)
    if (m) {
      const reason = w.plugin?.[m[2] as 'enable']
      if (reason) return Promise.reject(reason)
      if (m[2] === 'is_enabled') return Promise.resolve(w.enabled ?? false)
      if (m[2] === 'version') return Promise.resolve(w.version ?? '0.4.2')
    }
    return Promise.resolve(undefined)
  })
}

function renderModal() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><SettingsModal onClose={() => {}} /></QueryClientProvider>)
  return qc
}

const called = (cmd: string) => invokeMock.mock.calls.filter(([c]) => c === cmd)
const order = (cmd: string) => invokeMock.mock.calls.findIndex(([c]) => c === cmd)

describe('<SettingsModal />', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('UC-001 / AC-8: shows no gate setting and names the pause control Tạm dừng ghi nhận as a native checkbox', async () => {
    wire()
    renderModal()
    expect(await screen.findByRole('dialog', { name: 'Cài đặt' })).toHaveAttribute('aria-modal', 'true')
    const pause = await screen.findByRole('checkbox', { name: 'Tạm dừng ghi nhận' })
    expect(pause.tagName).toBe('INPUT')
    expect(pause).toHaveAttribute('type', 'checkbox')
    for (const gone of [/Observer/, /Interactive/, /Hybrid/, /Chế độ chạy/, /timeout/i, /Gate paths/]) {
      expect(screen.queryByText(gone)).not.toBeInTheDocument()
    }
    expect(screen.getAllByRole('button', { name: 'Đóng' })).toHaveLength(2)
  })

  it('UC-001 / AC-8: ticking the pause box saves paused', async () => {
    wire()
    renderModal()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Tạm dừng ghi nhận' }))
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('update_settings', { patch: { paused: true } }))
  })

  it('has the six sections with Vietnamese titles as h3', async () => {
    wire()
    renderModal()
    await screen.findByRole('checkbox', { name: 'Tạm dừng ghi nhận' })
    const titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(titles).toEqual(['Ghi nhận', 'Lưu giữ', 'Khởi động', 'Anthropic API', 'mem0 API', 'Về ứng dụng'])
    for (const gone of ['Pause', 'Retention', 'Autostart']) expect(screen.queryByText(gone)).not.toBeInTheDocument()
  })

  it('saves the retention days on blur', async () => {
    wire()
    renderModal()
    const input = await screen.findByLabelText('Số ngày lưu snapshot')
    fireEvent.change(input, { target: { value: '45' } })
    fireEvent.blur(input)
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('update_settings', { patch: { retention_days: 45 } }))
    expect(await screen.findByText('Đã lưu')).toBeInTheDocument()
  })

  it('a retention value that is not a whole number from 1 is not saved', async () => {
    wire()
    renderModal()
    const input = (await screen.findByLabelText('Số ngày lưu snapshot')) as HTMLInputElement
    expect(input).toHaveAttribute('min', '1')
    expect(input).toHaveAttribute('step', '1')
    for (const bad of ['7.5', '0', '-3', '', '1e20']) {
      fireEvent.change(input, { target: { value: bad } })
      fireEvent.blur(input)
      expect(input.value).toBe('30')
      expect(await screen.findByText('Không lưu được: số ngày phải là số nguyên từ 1 trở lên')).toBeInTheDocument()
    }
    expect(called('update_settings')).toHaveLength(0)
  })

  it('a whole number from 1 is saved', async () => {
    wire()
    renderModal()
    const input = await screen.findByLabelText('Số ngày lưu snapshot')
    fireEvent.change(input, { target: { value: '14' } })
    fireEvent.blur(input)
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('update_settings', { patch: { retention_days: 14 } }))
    expect(await screen.findByText('Đã lưu')).toBeInTheDocument()
  })

  it('a save that fails while the autostart switch is saving still shows its error', async () => {
    let rejectFirst: (e: unknown) => void = () => {}
    const first = new Promise((_, rej) => { rejectFirst = rej })
    let updates = 0
    invokeMock.mockImplementation((cmd: string, args?: unknown) => {
      if (cmd === 'get_settings') return Promise.resolve(SETTINGS)
      if (cmd === 'update_settings') {
        updates += 1
        return updates === 1 ? first : Promise.resolve({ ...SETTINGS, ...(args as { patch: object }).patch })
      }
      if (cmd === 'plugin:autostart|is_enabled') return Promise.resolve(false)
      if (cmd === 'plugin:app|version') return Promise.resolve('0.4.2')
      return Promise.resolve(undefined)
    })
    renderModal()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Tạm dừng ghi nhận' }))
    await waitFor(() => expect(updates).toBe(1))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Khởi động cùng máy' }))
    expect(await screen.findByText('Đã lưu')).toBeInTheDocument()
    rejectFirst(new Error('boom'))
    expect(await screen.findByText('Không lưu được: boom')).toBeInTheDocument()
  })

  it('has a labelled mem0 key field of type password with the approved note', async () => {
    wire()
    renderModal()
    const input = await screen.findByLabelText('mem0 API key')
    expect(input).toHaveAttribute('type', 'password')
    expect(screen.getByText('mem0 API')).toBeInTheDocument()
    expect(screen.getByText(/Chỉ dùng để đọc memory từ mem0 ở màn Memory & lỗi/)).toBeInTheDocument()
  })

  it('saves the mem0 key on blur', async () => {
    wire()
    renderModal()
    const input = await screen.findByLabelText('mem0 API key')
    fireEvent.change(input, { target: { value: 'm0-abc' } })
    fireEvent.blur(input)
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('update_settings', { patch: { mem0_api_key: 'm0-abc' } }))
  })

  it('does not save when an empty key is left unchanged', async () => {
    wire()
    renderModal()
    const input = await screen.findByLabelText('mem0 API key')
    fireEvent.focus(input)
    fireEvent.blur(input)
    expect(invokeMock).not.toHaveBeenCalledWith('update_settings', expect.anything())
  })

  it('restores the old settings and says Không lưu được when the update fails', async () => {
    wire({ updateFails: true })
    const qc = renderModal()
    const input = await screen.findByLabelText('mem0 API key')
    fireEvent.change(input, { target: { value: 'm0-abc' } })
    fireEvent.blur(input)
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('update_settings', expect.anything()))
    await waitFor(() => expect((qc.getQueryData(['settings']) as typeof SETTINGS).mem0_api_key).toBeNull())
    expect(await screen.findByText('Không lưu được: no')).toBeInTheDocument()
  })

  describe('autostart', () => {
    it('ticking the box calls the plugin enable before the flag is saved', async () => {
      wire()
      renderModal()
      const box = await screen.findByRole('checkbox', { name: 'Khởi động cùng máy' })
      await waitFor(() => expect(called('plugin:autostart|is_enabled')).toHaveLength(1))
      fireEvent.click(box)
      await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('update_settings', { patch: { autostart: true } }))
      expect(order('plugin:autostart|enable')).toBeGreaterThanOrEqual(0)
      expect(order('plugin:autostart|enable')).toBeLessThan(order('update_settings'))
      await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Khởi động cùng máy' })).toBeChecked())
    })

    it('unticking calls the plugin disable before the flag is saved', async () => {
      wire({ enabled: true })
      renderModal()
      const box = await screen.findByRole('checkbox', { name: 'Khởi động cùng máy' })
      await waitFor(() => expect(box).toBeChecked())
      fireEvent.click(box)
      await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('update_settings', { patch: { autostart: false } }))
      expect(order('plugin:autostart|disable')).toBeLessThan(order('update_settings'))
      expect(called('plugin:autostart|enable')).toHaveLength(0)
      await waitFor(() => expect(box).not.toBeChecked())
    })

    it('a failing plugin call saves nothing, leaves the box as it was and shows the reason', async () => {
      wire({ plugin: { enable: 'permission denied' } })
      renderModal()
      const box = await screen.findByRole('checkbox', { name: 'Khởi động cùng máy' })
      fireEvent.click(box)
      expect(await screen.findByText('Không lưu được: permission denied')).toBeInTheDocument()
      expect(box).not.toBeChecked()
      expect(invokeMock).not.toHaveBeenCalledWith('update_settings', expect.anything())
    })

    it('a failing flag save undoes the plugin change and reverts the box', async () => {
      wire({ updateFails: true })
      renderModal()
      const box = await screen.findByRole('checkbox', { name: 'Khởi động cùng máy' })
      fireEvent.click(box)
      expect(await screen.findByText('Không lưu được: no')).toBeInTheDocument()
      await waitFor(() => expect(called('plugin:autostart|disable')).toHaveLength(1))
      expect(box).not.toBeChecked()
    })

    it('shows what the system really has, not the stored flag', async () => {
      wire({ enabled: true })
      renderModal()
      const box = await screen.findByRole('checkbox', { name: 'Khởi động cùng máy' })
      await waitFor(() => expect(box).toBeChecked())
    })

    it('falls back to the stored flag when the system state cannot be read', async () => {
      wire({ plugin: { is_enabled: 'unavailable' } })
      renderModal()
      expect(await screen.findByRole('checkbox', { name: 'Khởi động cùng máy' })).not.toBeChecked()
    })
  })

  describe('Về ứng dụng', () => {
    it('shows the Tauri app version', async () => {
      wire({ version: '1.2.3' })
      renderModal()
      expect(await screen.findByText('claude-manager v1.2.3')).toBeInTheDocument()
      expect(screen.getByText('Phiên bản')).toBeInTheDocument()
    })

    it('drops the row when the version cannot be read', async () => {
      wire({ plugin: { version: 'nope' } })
      renderModal()
      await screen.findByRole('checkbox', { name: 'Khởi động cùng máy' })
      await waitFor(() => expect(called('plugin:app|version')).toHaveLength(1))
      expect(screen.queryByText('Phiên bản')).not.toBeInTheDocument()
      expect(screen.getByRole('heading', { level: 3, name: 'Về ứng dụng' })).toBeInTheDocument()
    })
  })

  describe('loading and read errors', () => {
    it('draws the dialog frame with skeletons while the settings load', async () => {
      wire({ settings: new Promise(() => {}) })
      renderModal()
      const dialog = await screen.findByRole('dialog', { name: 'Cài đặt' })
      expect(within(dialog).getAllByRole('button', { name: 'Đóng' })).toHaveLength(2)
      expect(within(dialog).queryByRole('checkbox')).toBeNull()
      expect(dialog.querySelectorAll('[aria-hidden="true"].animate-pulse-soft').length).toBeGreaterThan(0)
    })

    it('shows Không đọc được cài đặt with the error and a retry that reads again', async () => {
      let fail = true
      invokeMock.mockImplementation((cmd: string) => {
        if (cmd === 'get_settings') return fail ? Promise.reject(new Error('db locked')) : Promise.resolve(SETTINGS)
        return Promise.resolve(undefined)
      })
      renderModal()
      expect(await screen.findByText('Không đọc được cài đặt')).toBeInTheDocument()
      expect(screen.getByText('db locked')).toBeInTheDocument()
      fail = false
      fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }))
      expect(await screen.findByRole('checkbox', { name: 'Tạm dừng ghi nhận' })).toBeInTheDocument()
    })
  })
})
