import { describe, expect, it } from 'vitest'
import { resolveTransmute } from './spellResolvers'
import type { Cell, Player } from '../../types'
import type { RngState } from '../rng/mulberry32'

const player: Player = {
  hp: 60,
  maxHp: 60,
  block: 0,
  mana: { red: 0, blue: 0, green: 0, yellow: 0 },
  skillCharge: 0,
  phasePools: { red: 0, blue: 0, green: 0 },
  statuses: [],
  pendingSpells: [],
  carryBlockNextPhase: false,
  relics: [],
  gold: 0,
  ownedSpellIds: [],
}

function boardWithRow(colors: Cell['gemColor'][]): Cell[][] {
  const row = colors.map((gemColor) => ({ gemColor }))
  return Array.from({ length: 8 }, () => row.map((c) => ({ ...c })))
}

describe('resolveTransmute', () => {
  it('emits gems-transmuted before cascade events', () => {
    const board = boardWithRow(['red', 'red', 'red', 'blue', 'blue', 'blue', 'green', 'green'])
    const rng: RngState = { seed: 42 }
    const r = resolveTransmute(board, 'red', 'blue', rng, player, [], null, [], [])
    expect(r.events[0]).toEqual({
      kind: 'gems-transmuted',
      cells: expect.arrayContaining([
        { at: { x: 0, y: 0 }, color: 'blue' },
        { at: { x: 1, y: 0 }, color: 'blue' },
        { at: { x: 2, y: 0 }, color: 'blue' },
      ]),
    })
    expect(r.events.some((e) => e.kind === 'match-found')).toBe(true)
    const transmuteEvent = r.events[0]
    expect(transmuteEvent?.kind === 'gems-transmuted' && transmuteEvent.cells).toHaveLength(24)
  })
})
