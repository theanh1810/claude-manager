import { describe, it, expect } from 'vitest'
import { errorText, shortPath } from '../format'

describe('format', () => {
  it('errorText handles string, Error and other values', () => {
    expect(errorText('LEGACY_CONFIRM')).toBe('LEGACY_CONFIRM')
    expect(errorText(new Error('boom'))).toBe('boom')
    expect(errorText(42)).toBe('42')
  })
  it('shortPath keeps the last two segments', () => {
    expect(shortPath('D:/code/demo/src/main.ts')).toBe('src/main.ts')
    expect(shortPath('main.ts')).toBe('main.ts')
  })
})
