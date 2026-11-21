// Component tests for <MarkdownView />.
//
// The react-markdown pipeline loads through a dynamic import, so every case first awaits the
// document (`findDoc`); the skeleton case looks at the frame before that.

import { describe, it, expect } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import MarkdownView from '../MarkdownView'

type Heading = 1 | 2 | 3 | 4 | 5 | 6

async function renderDoc(markdown: string, headingLevel?: Heading) {
  const view = render(<MarkdownView markdown={markdown} headingLevel={headingLevel} />)
  await view.findByText((_, el) => el?.classList.contains('md') ?? false)
  return view
}

describe('<MarkdownView />', () => {
  it('shows skeleton rows until the pipeline has loaded, then the document in the .md block', async () => {
    const { container, findByText } = render(<MarkdownView markdown={'Xin chào'} />)
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(container.querySelector('.md')).toBeNull()
    await findByText('Xin chào')
    expect(container.querySelector('[aria-busy="true"]')).toBeNull()
    expect(container.firstElementChild).toHaveClass('md')
    expect(container.firstElementChild?.className).not.toContain('prose')
  })

  it('UC-003/AC-9 the plan document renders open with its headings and text', async () => {
    await renderDoc('# Kế hoạch\n\nNội dung đầu tiên.')
    expect(screen.getByRole('heading', { level: 1, name: 'Kế hoạch' })).toBeInTheDocument()
    expect(screen.getByText('Nội dung đầu tiên.')).toBeInTheDocument()
  })

  it('UC-002/AC-2 a file entry shows its path and line as code', async () => {
    await renderDoc('Sửa `src/app.rs:42` rồi chạy lại.')
    const code = screen.getByText('src/app.rs:42')
    expect(code.tagName).toBe('CODE')
  })

  it('a fenced block without a language scrolls inside its own box and keeps whole words', async () => {
    const { container } = await renderDoc('```\n' + 'a'.repeat(300) + '\n```')
    const pre = container.querySelector('pre')
    expect(pre).toHaveClass('overflow-x-auto', 'whitespace-pre', '[overflow-wrap:normal]')
    expect(container.querySelector('[data-testid="prism-fallback"]')).toBeNull()
    expect(container.querySelectorAll('pre')).toHaveLength(1)
  })

  it('a fenced block with a language brings its own box, not a second one around it', async () => {
    const { container } = await renderDoc('```ts\nconst x = 1\n```')
    expect(container.querySelectorAll('pre')).toHaveLength(1)
    // The fallback and the highlighted block share these classes, so the check holds either side of the chunk load.
    expect(container.querySelector('pre')).toHaveClass('overflow-x-auto', '[overflow-wrap:normal]')
  })

  it('a wide table scrolls inside its own box and its cells keep whole words', async () => {
    const cols = Array.from({ length: 12 }, (_, i) => `https://example.com/${'x'.repeat(30)}${i}`)
    const md = `| ${cols.join(' | ')} |\n|${cols.map(() => '---').join('|')}|\n| ${cols.join(' | ')} |`
    await renderDoc(md)
    expect(screen.getByRole('table')).toHaveClass('max-w-full', '[overflow-wrap:normal]')
  })

  it('renders a GFM table (proves remark-gfm plugin is active)', async () => {
    await renderDoc('| a | b |\n|---|---|\n| 1 | 2 |')
    expect(screen.getByRole('columnheader', { name: 'a' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '1' })).toBeInTheDocument()
  })

  it('renders inline `code` as a plain code element', async () => {
    await renderDoc('Hello `world` here.')
    expect(screen.getByText('world').tagName).toBe('CODE')
  })

  it('document headings start at the given level, keep their source size and stop at h6', async () => {
    await renderDoc('# A\n\n## B\n\n### C\n\n#### D', 4)
    expect(screen.getByRole('heading', { level: 4, name: 'A' })).toHaveClass('!text-lg')
    expect(screen.getByRole('heading', { level: 5, name: 'B' })).toHaveClass('!text-md')
    expect(screen.getByRole('heading', { level: 6, name: 'C' })).toHaveClass('!text-sm')
    expect(screen.getByRole('heading', { level: 6, name: 'D' })).toHaveClass('!text-sm')
  })

  it('without a level the document keeps its own h1 to h6', async () => {
    await renderDoc('# A\n\n## B')
    expect(screen.getByRole('heading', { level: 1, name: 'A' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'B' })).toBeInTheDocument()
  })

  it('a remote image is never loaded: no img element, alt and URL shown as text', async () => {
    const { container } = await renderDoc('![sơ đồ](http://host/remote-image.png)\n\n![](https://host/b.png)\n\n![x](javascript:alert(1))')
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('[Ảnh: sơ đồ] http://host/remote-image.png')).toBeInTheDocument()
    expect(screen.getByText('[Ảnh] https://host/b.png')).toBeInTheDocument()
    expect(screen.getByText('[Ảnh: x]')).toBeInTheDocument()
  })

  it('a javascript:, data: or empty link renders as plain text with no anchor', async () => {
    const markdown = ['[js](javascript:alert(1))', '[page](data:text/html;base64,AAAA)', '[empty]()', '[rel](./other.md)', '[anchor](#top)', '[mail](mailto:a@b.c)'].join('\n\n')
    const { container } = await renderDoc(markdown)
    expect(container.querySelector('a')).toBeNull()
    for (const text of ['js', 'page', 'empty', 'rel', 'anchor', 'mail']) {
      expect(screen.getByText(text)).toBeInTheDocument()
    }
    expect(container.textContent).not.toContain('javascript:')
  })

  it('an http link renders its text and URL with no anchor', async () => {
    const { container } = await renderDoc('See [the docs](https://example.com/a) or https://example.org/b now.')
    expect(container.querySelector('a')).toBeNull()
    expect(screen.getByText('the docs')).toBeInTheDocument()
    expect(screen.getByText('(https://example.com/a)')).toHaveClass('font-mono')
    expect(container.textContent?.match(/https:\/\/example\.org\/b/g)).toHaveLength(1)
  })

  it('a fenced block with a language resolves to the Prism-highlighted box on tokens', async () => {
    render(<MarkdownView markdown={'```ts\nconst x: number = 1\n```'} />)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    const highlighted = await screen.findByTestId('prism-block')
    expect(highlighted).toHaveAttribute('data-prism', 'ts')
    expect(highlighted).toHaveClass('bg-surface-1', 'border-line')
  })
})
