import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  armProcBlockTrailBackup,
  createProcBlockAudioSlot,
  resolveProcBlockSound,
  scheduleProcBlockTrailSfx,
} from './procBlockSfx'

describe('resolveProcBlockSound', () => {
  it('plays thump on absorbed', () => {
    expect(resolveProcBlockSound('absorbed', 3, 0)).toBe('thump')
  })

  it('plays crack on broken', () => {
    expect(resolveProcBlockSound('broken', 2, 3)).toBe('crack')
  })

  it('falls back to crack for partial block without block-* events', () => {
    expect(resolveProcBlockSound(null, 2, 3)).toBe('crack')
  })

  it('falls back to thump for full block absorb without block-* events', () => {
    expect(resolveProcBlockSound(null, 3, 0)).toBe('thump')
  })

  it('returns null when nothing was blocked', () => {
    expect(resolveProcBlockSound(null, 0, 5)).toBeNull()
  })
})

describe('proc block trail backup', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('window', globalThis)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('backup plays when trail never claims', () => {
    const slot = createProcBlockAudioSlot()
    const thump = vi.fn()
    const crack = vi.fn()
    armProcBlockTrailBackup(slot, 'absorbed', 4, 0, thump, crack)
    vi.advanceTimersByTime(900)
    expect(thump).toHaveBeenCalledWith(4)
    expect(crack).not.toHaveBeenCalled()
  })

  it('trail claim prevents backup double-play', () => {
    const slot = createProcBlockAudioSlot()
    const thump = vi.fn()
    const crack = vi.fn()
    armProcBlockTrailBackup(slot, 'absorbed', 4, 0, thump, crack)
    scheduleProcBlockTrailSfx(slot, 'absorbed', 4, 0, 200, thump, crack)
    vi.advanceTimersByTime(200)
    expect(thump).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(900)
    expect(thump).toHaveBeenCalledTimes(1)
  })
})
