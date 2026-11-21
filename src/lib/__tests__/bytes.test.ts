import { describe, it, expect } from 'vitest'
import { formatBytes } from '../bytes'

describe('formatBytes', () => {
  it('keeps plain bytes below 1 KB', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1023)).toBe('1023 B')
  })

  it('writes the decimal with a comma and one digit under 100', () => {
    expect(formatBytes(1536)).toBe('1,5 KB')
    expect(formatBytes(1024 * 1024)).toBe('1,0 MB')
  })

  it('drops the decimal from 100 up and stops at TB', () => {
    expect(formatBytes(150 * 1024)).toBe('150 KB')
    expect(formatBytes(2048 * 1024 ** 4)).toBe('2048 TB')
  })
})
