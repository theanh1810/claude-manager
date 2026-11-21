/** The lines of a text: an empty text has none, so a new file does not count a phantom empty line. */
function linesOf(text: string): string[] {
  return text === '' ? [] : text.split('\n')
}

/**
 * The length D of the shortest edit script between two line lists (Myers, 1986): the least number of
 * lines to delete and insert to turn `a` into `b`. Replacing one line is a delete plus an insert, D = 2.
 */
function editDistance(a: string[], b: string[]): number {
  const n = a.length
  const m = b.length
  const max = n + m
  if (max === 0) return 0
  const offset = max + 1
  // furthest[k + offset] is the furthest x reached on diagonal k = x - y.
  const furthest = new Int32Array(2 * max + 3)
  for (let d = 0; d <= max; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && furthest[k - 1 + offset] < furthest[k + 1 + offset]) ? furthest[k + 1 + offset] : furthest[k - 1 + offset] + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      furthest[k + offset] = x
      if (x >= n && y >= m) return d
    }
  }
  return max
}

/**
 * Lines added and removed by a change, counted over the shortest line-by-line difference of the two
 * contents (UC-001/AC-17). With N lines before, M after and D the shortest edit length, the removed
 * lines are (D - M + N) / 2 and the added ones (D + M - N) / 2.
 */
export function countLineChanges(before: string, after: string): { added: number; removed: number } {
  const a = linesOf(before)
  const b = linesOf(after)
  // The lines both sides share at the start and the end are never part of the difference.
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  const left = a.slice(head, a.length - tail)
  const right = b.slice(head, b.length - tail)
  const d = editDistance(left, right)
  return { added: (d + right.length - left.length) / 2, removed: (d - right.length + left.length) / 2 }
}
