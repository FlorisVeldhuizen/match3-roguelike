import { describe, expect, it } from 'vitest'
import {
  applyStatusToList,
  composeDamage,
  hasStatus,
  tickStatuses,
} from './statuses'
import type { StatusInstance } from '../../types'

const burn = (stacks: number): StatusInstance => ({ kind: 'burn', stacks })
const vuln = (stacks: number): StatusInstance => ({
  kind: 'vulnerable',
  stacks,
})
const weak = (stacks: number): StatusInstance => ({ kind: 'weak', stacks })

describe('applyStatusToList', () => {
  it('adds a fresh status when none of that kind exists', () => {
    const next = applyStatusToList([], burn(2))
    expect(next).toEqual([burn(2)])
  })

  it('Burn re-application sums stacks (StS pattern — same number is dmg+turns)', () => {
    let list: StatusInstance[] = [burn(2)]
    list = applyStatusToList(list, burn(1))
    expect(list).toEqual([burn(3)])
    list = applyStatusToList(list, burn(2))
    expect(list).toEqual([burn(5)])
  })

  it('Vulnerable re-application takes the longer remaining (refresh, no stack)', () => {
    let list: StatusInstance[] = [vuln(2)]
    list = applyStatusToList(list, vuln(5))
    expect(list).toEqual([vuln(5)])
    // Smaller incoming does not shorten an active stack.
    list = applyStatusToList(list, vuln(1))
    expect(list).toEqual([vuln(5)])
  })

  it('Weak re-application takes the longer remaining', () => {
    let list: StatusInstance[] = [weak(2)]
    list = applyStatusToList(list, weak(1))
    expect(list).toEqual([weak(2)])
  })
})

describe('tickStatuses', () => {
  it('Burn deals stacks dmg, then stacks decrements; vuln/weak just decay', () => {
    const res = tickStatuses('player', [burn(2), vuln(2)])
    expect(res.statuses).toEqual([burn(1), vuln(1)])
    expect(res.burnDamage).toBe(2) // captured BEFORE decrement
    const ticked = res.events.filter((e) => e.kind === 'status-ticked')
    expect(ticked).toHaveLength(2)
  })

  it('expires statuses whose stacks was 1, emits status-expired', () => {
    const res = tickStatuses('player', [burn(1), vuln(1)])
    expect(res.statuses).toEqual([])
    // burn still deals its damage on the expiring tick
    expect(res.burnDamage).toBe(1)
    const expired = res.events.filter((e) => e.kind === 'status-expired')
    expect(expired).toHaveLength(2)
  })

  it('Burn 3 ticks over 3 turns: 3 → 2 → 1 → expired (6 total dmg)', () => {
    let statuses: StatusInstance[] = [burn(3)]
    let total = 0
    for (let i = 0; i < 3; i++) {
      const res = tickStatuses('player', statuses)
      total += res.burnDamage
      statuses = res.statuses
    }
    expect(total).toBe(6) // 3 + 2 + 1
    expect(statuses).toEqual([])
  })

  it('sums burn stacks across multiple Burn instances (defensive)', () => {
    const res = tickStatuses('enemy-1', [burn(2), burn(3)])
    // Normally applyStatusToList merges burn into one; tick handles
    // multiples defensively anyway.
    expect(res.burnDamage).toBe(5)
  })
})

describe('composeDamage', () => {
  it('returns raw amount when no statuses', () => {
    expect(composeDamage(5, [], [])).toBe(5)
  })

  it('Weak on source halves outgoing (floor)', () => {
    expect(composeDamage(5, [weak(2)], [])).toBe(2)
    expect(composeDamage(8, [weak(2)], [])).toBe(4)
  })

  it('Vulnerable on target adds 50% to incoming (floor)', () => {
    expect(composeDamage(4, [], [vuln(2)])).toBe(6)
    expect(composeDamage(5, [], [vuln(2)])).toBe(7) // floor(7.5)
  })

  it('Weak and Vulnerable compose multiplicatively: 0.5 × 1.5 = 0.75', () => {
    expect(composeDamage(8, [weak(2)], [vuln(2)])).toBe(6)
    expect(composeDamage(10, [weak(2)], [vuln(2)])).toBe(7) // floor(7.5)
  })

  it('returns 0 for non-positive input', () => {
    expect(composeDamage(0, [vuln(1)], [])).toBe(0)
  })
})

describe('hasStatus', () => {
  it('is true iff the kind is present', () => {
    expect(hasStatus([burn(1)], 'burn')).toBe(true)
    expect(hasStatus([burn(1)], 'vulnerable')).toBe(false)
  })
})
