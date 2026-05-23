import { describe, it, expect } from 'vitest'
import { applyDamage } from './damage'

describe('applyDamage', () => {
  it('routes damage to HP when there is no block', () => {
    const r = applyDamage(0, 10, 4)
    expect(r).toMatchObject({
      blockAfter: 0,
      hpAfter: 6,
      hpDamage: 4,
      blocked: 0,
      blockBroken: false,
      blockAbsorbed: false,
      killed: false,
    })
  })

  it('absorbs everything when block covers the hit', () => {
    const r = applyDamage(5, 10, 3)
    expect(r).toMatchObject({
      blockAfter: 2,
      hpAfter: 10,
      hpDamage: 0,
      blocked: 3,
      blockBroken: false,
      blockAbsorbed: true,
    })
  })

  it('splits damage and reports blockBroken when shield runs out', () => {
    const r = applyDamage(2, 10, 5)
    expect(r).toMatchObject({
      blockAfter: 0,
      hpAfter: 7,
      hpDamage: 3,
      blocked: 2,
      blockBroken: true,
      blockAbsorbed: false,
    })
  })

  it('clamps hpDamage at remaining HP on overkill', () => {
    const r = applyDamage(0, 3, 10)
    expect(r.hpAfter).toBe(0)
    expect(r.hpDamage).toBe(3)
    expect(r.killed).toBe(true)
  })

  it('reports killed only on a fresh kill (not a hit on an already-dead target)', () => {
    const r = applyDamage(0, 0, 5)
    expect(r.killed).toBe(false)
    expect(r.hpDamage).toBe(0)
  })

  it('does not flag blockBroken when block was already zero', () => {
    const r = applyDamage(0, 10, 3)
    expect(r.blockBroken).toBe(false)
  })

  it('does not flag blockAbsorbed on a no-op zero-incoming hit', () => {
    const r = applyDamage(5, 10, 0)
    expect(r).toMatchObject({
      blocked: 0,
      hpDamage: 0,
      blockAbsorbed: false,
    })
  })
})
