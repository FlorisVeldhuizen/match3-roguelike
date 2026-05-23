import { describe, expect, it } from 'vitest'
import {
  applyStatusToList,
  composeDamage,
  hasStatus,
  tickStatuses,
} from './statuses'
import type { StatusInstance } from '../../types'

const burn = (stacks: number, duration: number): StatusInstance => ({
  kind: 'burn',
  stacks,
  duration,
})
const vuln = (duration: number): StatusInstance => ({
  kind: 'vulnerable',
  stacks: 1,
  duration,
})
const weak = (duration: number): StatusInstance => ({
  kind: 'weak',
  stacks: 1,
  duration,
})

describe('applyStatusToList', () => {
  it('adds a fresh status when none of that kind exists', () => {
    const next = applyStatusToList([], burn(2, 3))
    expect(next).toEqual([burn(2, 3)])
  })

  it('Burn stacks damage AND refreshes duration to the max of (old, new)', () => {
    let list: StatusInstance[] = [burn(2, 3)]
    list = applyStatusToList(list, burn(1, 4))
    expect(list).toEqual([burn(3, 4)])
    list = applyStatusToList(list, burn(2, 2))
    // duration max(4, 2) = 4 (refresh keeps the longer one)
    expect(list).toEqual([burn(5, 4)])
  })

  it('Vulnerable refreshes duration only — multiplier does NOT stack', () => {
    let list: StatusInstance[] = [vuln(2)]
    list = applyStatusToList(list, vuln(5))
    expect(list).toEqual([vuln(5)])
    // stacks clamped at 1 even if caller passes higher
    list = applyStatusToList(list, { kind: 'vulnerable', stacks: 4, duration: 3 })
    expect(list).toEqual([vuln(5)])
  })

  it('Weak refreshes duration only', () => {
    let list: StatusInstance[] = [weak(2)]
    list = applyStatusToList(list, weak(1))
    // max(2, 1) = 2
    expect(list).toEqual([weak(2)])
  })
})

describe('tickStatuses', () => {
  it('decrements duration, emits ticked events while remaining > 0', () => {
    const res = tickStatuses('player', [burn(2, 3), vuln(2)])
    expect(res.statuses).toEqual([burn(2, 2), vuln(1)])
    expect(res.burnDamage).toBe(2)
    const ticked = res.events.filter((e) => e.kind === 'status-ticked')
    expect(ticked).toHaveLength(2)
  })

  it('expires statuses whose duration was 1, emits status-expired', () => {
    const res = tickStatuses('player', [burn(3, 1), vuln(1)])
    expect(res.statuses).toEqual([])
    // burn still deals its damage on the expiring tick
    expect(res.burnDamage).toBe(3)
    const expired = res.events.filter((e) => e.kind === 'status-expired')
    expect(expired).toHaveLength(2)
  })

  it('sums burn stacks across multiple Burn instances (defense against future stacking bugs)', () => {
    const res = tickStatuses('enemy-1', [burn(2, 2), burn(3, 5)])
    // there should only be one Burn instance per owner under normal apply
    // rules, but tick must still report the total deterministically.
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
    expect(hasStatus([burn(1, 1)], 'burn')).toBe(true)
    expect(hasStatus([burn(1, 1)], 'vulnerable')).toBe(false)
  })
})
