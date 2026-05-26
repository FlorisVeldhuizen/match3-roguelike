import { describe, expect, it } from 'vitest'
import type { MapNode } from '../../types'
import { rollGoldDrop } from './goldDrop'

const node = (overrides: Partial<MapNode>): MapNode => ({
  id: 'n',
  kind: 'fight',
  column: 0,
  lane: 0,
  ...overrides,
})

describe('rollGoldDrop', () => {
  it('col-0 fight drops 10-15g', () => {
    let rng = { seed: 1 }
    for (let i = 0; i < 200; i++) {
      const r = rollGoldDrop(node({ kind: 'fight', column: 0 }), rng)
      expect(r.gold).toBeGreaterThanOrEqual(10)
      expect(r.gold).toBeLessThanOrEqual(15)
      rng = r.rng
    }
  })

  it('col-1 fight drops 10-15g (same band as col 0)', () => {
    let rng = { seed: 2 }
    for (let i = 0; i < 200; i++) {
      const r = rollGoldDrop(node({ kind: 'fight', column: 1 }), rng)
      expect(r.gold).toBeGreaterThanOrEqual(10)
      expect(r.gold).toBeLessThanOrEqual(15)
      rng = r.rng
    }
  })

  it('col-2 fight drops 15-20g', () => {
    let rng = { seed: 3 }
    for (let i = 0; i < 200; i++) {
      const r = rollGoldDrop(node({ kind: 'fight', column: 2 }), rng)
      expect(r.gold).toBeGreaterThanOrEqual(15)
      expect(r.gold).toBeLessThanOrEqual(20)
      rng = r.rng
    }
  })

  it('col-3 fight drops 20-25g', () => {
    let rng = { seed: 4 }
    for (let i = 0; i < 200; i++) {
      const r = rollGoldDrop(node({ kind: 'fight', column: 3 }), rng)
      expect(r.gold).toBeGreaterThanOrEqual(20)
      expect(r.gold).toBeLessThanOrEqual(25)
      rng = r.rng
    }
  })

  it('elite drops 35-50g regardless of column', () => {
    let rng = { seed: 5 }
    for (let i = 0; i < 200; i++) {
      const r = rollGoldDrop(node({ kind: 'elite', column: 2 }), rng)
      expect(r.gold).toBeGreaterThanOrEqual(35)
      expect(r.gold).toBeLessThanOrEqual(50)
      rng = r.rng
    }
  })

  it('boss drops 0g', () => {
    const r = rollGoldDrop(node({ kind: 'boss', column: 5 }), { seed: 6 })
    expect(r.gold).toBe(0)
  })

  it('is deterministic for the same seed', () => {
    const a = rollGoldDrop(node({ kind: 'elite', column: 2 }), { seed: 99 })
    const b = rollGoldDrop(node({ kind: 'elite', column: 2 }), { seed: 99 })
    expect(a.gold).toBe(b.gold)
    expect(a.rng.seed).toBe(b.rng.seed)
  })

  it('advances the rng', () => {
    const start = { seed: 7 }
    const r = rollGoldDrop(node({ kind: 'fight', column: 2 }), start)
    expect(r.rng.seed).not.toBe(start.seed)
  })
})
