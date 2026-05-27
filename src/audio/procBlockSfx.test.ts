import { describe, expect, it } from 'vitest'
import { resolvePlayerProcBlockSound } from './procBlockSfx'

describe('resolvePlayerProcBlockSound', () => {
  it('plays thump on absorbed', () => {
    expect(resolvePlayerProcBlockSound('absorbed', 3, 0)).toBe('thump')
  })

  it('plays crack on broken', () => {
    expect(resolvePlayerProcBlockSound('broken', 2, 3)).toBe('crack')
  })

  it('falls back to crack for partial block without block-* events', () => {
    expect(resolvePlayerProcBlockSound(null, 2, 3)).toBe('crack')
  })

  it('falls back to thump for full block absorb without block-* events', () => {
    expect(resolvePlayerProcBlockSound(null, 3, 0)).toBe('thump')
  })

  it('returns null when nothing was blocked', () => {
    expect(resolvePlayerProcBlockSound(null, 0, 5)).toBeNull()
  })
})
