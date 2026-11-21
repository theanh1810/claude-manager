import { describe, expect, it } from 'vitest'
import { countLineChanges } from '../lineStats'

const text = (...lines: string[]) => lines.join('\n')

/** Reference answer: the longest common subsequence by dynamic programming. */
function reference(before: string, after: string) {
  const a = before === '' ? [] : before.split('\n')
  const b = after === '' ? [] : after.split('\n')
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      lcs[i][j] = a[i - 1] === b[j - 1] ? lcs[i - 1][j - 1] + 1 : Math.max(lcs[i - 1][j], lcs[i][j - 1])
  return { added: b.length - lcs[a.length][b.length], removed: a.length - lcs[a.length][b.length] }
}

describe('countLineChanges', () => {
  it('UC-001/AC-17 replacing one line counts one added and one removed', () => {
    expect(countLineChanges(text('a', 'b', 'c'), text('a', 'x', 'c'))).toEqual({ added: 1, removed: 1 })
  })

  it('UC-001/AC-17 appending two lines counts two added and none removed', () => {
    expect(countLineChanges('a', text('a', 'b', 'c'))).toEqual({ added: 2, removed: 0 })
  })

  it('deleting two lines counts two removed and none added', () => {
    expect(countLineChanges(text('a', 'b', 'c'), 'a')).toEqual({ added: 0, removed: 2 })
  })

  it('identical content counts nothing', () => {
    expect(countLineChanges(text('a', 'b'), text('a', 'b'))).toEqual({ added: 0, removed: 0 })
    expect(countLineChanges('', '')).toEqual({ added: 0, removed: 0 })
  })

  it('a new file counts every line as added, an emptied file every line as removed', () => {
    expect(countLineChanges('', text('a', 'b', 'c'))).toEqual({ added: 3, removed: 0 })
    expect(countLineChanges(text('a', 'b'), '')).toEqual({ added: 0, removed: 2 })
  })

  it('a moved line counts as one removed and one added, not as the whole block', () => {
    expect(countLineChanges(text('a', 'b', 'c', 'd'), text('b', 'c', 'd', 'a'))).toEqual({ added: 1, removed: 1 })
  })

  it('a change in the middle of a long file counts only the changed lines', () => {
    const before = Array.from({ length: 500 }, (_, i) => `line ${i}`)
    const after = [...before]
    after.splice(250, 2, 'new a', 'new b', 'new c')
    expect(countLineChanges(before.join('\n'), after.join('\n'))).toEqual({ added: 3, removed: 2 })
  })

  it('a net growth of lines no longer hides the replaced ones (the old count read +0 -0 for a one-line replace)', () => {
    const { added, removed } = countLineChanges(text('a', 'b'), text('a', 'x', 'y'))
    expect(added - removed).toBe(1)
    expect(removed).toBe(1)
  })

  it('agrees with the longest-common-subsequence answer on 300 random small inputs', () => {
    let seed = 7
    const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    const pick = (n: number) => Array.from({ length: Math.floor(next() * n) }, () => 'abcd'[Math.floor(next() * 4)])
    for (let i = 0; i < 300; i++) {
      const before = pick(9).join('\n')
      const after = pick(9).join('\n')
      expect(countLineChanges(before, after), `${JSON.stringify(before)} -> ${JSON.stringify(after)}`).toEqual(reference(before, after))
    }
  })
})
