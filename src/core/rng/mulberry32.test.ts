import { describe, it, expect } from 'vitest'
import { next, nextInt, pick, shuffle, type RngState } from './mulberry32'
import { forkStreams } from './streams'

describe('mulberry32', () => {
  it('produces deterministic sequences for the same seed', () => {
    const a: RngState = { seed: 12345 }
    const b: RngState = { seed: 12345 }
    const seqA: number[] = []
    const seqB: number[] = []
    let ra = a
    let rb = b
    for (let i = 0; i < 100; i++) {
      const [va, na] = next(ra)
      const [vb, nb] = next(rb)
      seqA.push(va)
      seqB.push(vb)
      ra = na
      rb = nb
    }
    expect(seqA).toEqual(seqB)
  })

  it('produces different sequences for different seeds', () => {
    let ra: RngState = { seed: 1 }
    let rb: RngState = { seed: 2 }
    const seqA: number[] = []
    const seqB: number[] = []
    for (let i = 0; i < 10; i++) {
      const [va, na] = next(ra)
      const [vb, nb] = next(rb)
      seqA.push(va)
      seqB.push(vb)
      ra = na
      rb = nb
    }
    expect(seqA).not.toEqual(seqB)
  })

  it('nextInt stays in [0, max)', () => {
    let r: RngState = { seed: 7 }
    for (let i = 0; i < 1000; i++) {
      const [v, n] = nextInt(r, 5)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(5)
      r = n
    }
  })

  it('pick returns an element of the array', () => {
    const arr = ['a', 'b', 'c'] as const
    let r: RngState = { seed: 42 }
    for (let i = 0; i < 50; i++) {
      const [v, n] = pick(r, arr)
      expect(arr).toContain(v)
      r = n
    }
  })

  it('shuffle returns a permutation', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8]
    const [out] = shuffle({ seed: 99 }, arr)
    expect(out.slice().sort()).toEqual(arr.slice().sort())
    expect(out.length).toBe(arr.length)
  })
})

describe('forkStreams', () => {
  it('same root seed → same streams', () => {
    const a = forkStreams('hello')
    const b = forkStreams('hello')
    expect(a).toEqual(b)
  })

  it('different streams have different seeds', () => {
    const s = forkStreams('hello')
    const seeds = new Set([s.board.seed, s.enemy.seed, s.loot.seed, s.map.seed])
    expect(seeds.size).toBe(4)
  })
})
