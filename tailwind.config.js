/** @type {import('tailwindcss').Config} */
// Colours, font sizes, radii and shadows are replaced, not extended (design D4): only the
// token keys exist, so a raw palette class renders no style. The semantic colour keys read
// the CSS variables of src/styles/globals.css as RGB triplets so `/ <alpha-value>` works.
const c = (name) => `rgb(var(--${name}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'media',
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      inherit: 'inherit',
      surface: { 0: c('surface-0'), 1: c('surface-1'), 2: c('surface-2'), 3: c('surface-3') },
      ink: { DEFAULT: c('ink'), muted: c('ink-muted'), subtle: c('ink-subtle'), disabled: c('ink-disabled') },
      line: { DEFAULT: c('line'), strong: c('line-strong'), control: c('line-control') },
      accent: {
        DEFAULT: c('accent'),
        hover: c('accent-hover'),
        active: c('accent-active'),
        fg: c('accent-fg'),
        subtle: c('accent-subtle'),
        'subtle-hover': c('accent-subtle-hover'),
        on: c('on-accent')
      },
      success: { bg: c('success-bg'), fg: c('success-fg'), line: c('success-line'), solid: c('success-solid'), 'solid-hover': c('success-solid-hover') },
      danger: { bg: c('danger-bg'), fg: c('danger-fg'), line: c('danger-line'), solid: c('danger-solid'), 'solid-hover': c('danger-solid-hover') },
      warning: { bg: c('warning-bg'), fg: c('warning-fg'), line: c('warning-line'), solid: c('warning-solid'), 'solid-hover': c('warning-solid-hover') },
      info: { bg: c('info-bg'), fg: c('info-fg'), line: c('info-line') },
      progress: c('progress-fill'),
      tooltip: { bg: c('tooltip-bg'), fg: c('tooltip-fg') },
      knob: c('switch-knob'),
      scrim: 'rgb(var(--scrim) / var(--scrim-a))',
      diff: {
        'add-bg': c('diff-add-bg'),
        'add-gutter': c('diff-add-gutter'),
        'add-word': c('diff-add-word'),
        'del-bg': c('diff-del-bg'),
        'del-gutter': c('diff-del-gutter'),
        'del-word': c('diff-del-word')
      }
    },
    fontSize: {
      xs: ['12px', { lineHeight: '16px' }],
      sm: ['13px', { lineHeight: '20px' }],
      md: ['15px', { lineHeight: '22px' }],
      lg: ['18px', { lineHeight: '26px' }]
    },
    borderRadius: { none: '0', sm: '4px', md: '6px', lg: '8px', xl: '12px', full: '9999px' },
    boxShadow: { none: 'none', popover: 'var(--shadow-popover)', dialog: 'var(--shadow-dialog)' },
    extend: {
      zIndex: {
        base: '0',
        raised: '10',
        dropdown: '100',
        sticky: '200',
        overlay: '300',
        modal: '400',
        popover: '500',
        toast: '600',
        top: '9999'
      },
      transitionDuration: {
        fast: 'var(--dur-fast)',
        base: 'var(--dur-base)',
        slow: 'var(--dur-slow)',
        exit: 'var(--dur-exit)'
      },
      transitionTimingFunction: {
        out: 'var(--ease-out)',
        in: 'var(--ease-in)',
        standard: 'var(--ease-standard)'
      },
      width: {
        sidebar: 'var(--sidebar-w)',
        rail: 'var(--rail-w)',
        pane: 'var(--pane-list-w)',
        notice: 'var(--notice-w)',
        menu: '232px',
        'dialog-sm': '400px',
        'dialog-md': '480px',
        'dialog-lg': '560px'
      },
      height: {
        header: 'var(--header-h)',
        slot: 'var(--slot-status-h)',
        'row-edit': '72px',
        'row-memory': '56px',
        'row-session': '64px',
        'row-session-warn': '84px',
        'row-group': '36px',
        'row-cleanup': '36px',
        'detail-head': '108px',
        'diff-bar': '36px',
        'footer-bar': '56px',
        explain: 'clamp(200px, 40%, 320px)'
      },
      minWidth: { pane: 'var(--pane-list-w)' },
      maxWidth: { tooltip: '240px' },
      maxHeight: { menu: '320px', 'memory-problems': '168px' },
      inset: { header: 'var(--header-h)' },
      keyframes: {
        'enter-rise': { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'enter-scale': { from: { opacity: '0', transform: 'scale(0.98)' }, to: { opacity: '1', transform: 'scale(1)' } },
        'exit-scale': { from: { opacity: '1', transform: 'scale(1)' }, to: { opacity: '0', transform: 'scale(0.98)' } },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'fade-out': { from: { opacity: '1' }, to: { opacity: '0' } },
        'slide-in-left': { from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(0)' } },
        'pulse-soft': { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.55' } }
      },
      animation: {
        'enter-rise': 'enter-rise var(--dur-base) var(--ease-out) both',
        'enter-scale': 'enter-scale var(--dur-base) var(--ease-out) both',
        'exit-scale': 'exit-scale var(--dur-exit) var(--ease-in) both',
        'fade-in': 'fade-in var(--dur-fast) var(--ease-out) both',
        'fade-out': 'fade-out var(--dur-exit) var(--ease-in) both',
        'slide-in-left': 'slide-in-left var(--dur-slow) var(--ease-out) both',
        'pulse-soft': 'pulse-soft 1.4s ease-in-out infinite',
        spin: 'spin 0.9s linear infinite'
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Text"', '"Segoe UI Variable Text"', '"Segoe UI"', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', '"SF Mono"', 'Menlo', '"Cascadia Mono"', 'Consolas', '"Liberation Mono"', 'monospace']
      }
    }
  },
  plugins: []
}
