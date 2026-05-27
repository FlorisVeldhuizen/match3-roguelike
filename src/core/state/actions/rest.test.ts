import { describe, expect, it, beforeEach } from 'vitest'
import { useGameStore } from '../store'
// Side-effect imports: register relics + spells + archetypes used by the
// initial store state. Without these, freshFight / makePlayer would
// throw at boot.
import '../../../content/relics'
import '../../../content/spells'
import '../../../content/enemies'

const resetStore = () => useGameStore.getState().restart()

describe('rest actions', () => {
  beforeEach(() => {
    resetStore()
  })

  it('restHeal heals 30% of maxHp (rounded), clamped to maxHp', () => {
    // Force a fresh fight + put the player at low HP
    useGameStore.setState((s) => {
      s.fight.player.hp = 5
      s.runPhase = 'rest'
    })
    const before = useGameStore.getState().fight.player.hp
    const maxHp = useGameStore.getState().fight.player.maxHp
    useGameStore.getState().restHeal()
    const after = useGameStore.getState().fight.player.hp
    const expected = Math.min(maxHp, before + Math.round(maxHp * 0.3))
    expect(after).toBe(expected)
    expect(useGameStore.getState().runPhase).toBe('map')
  })

  it('restHeal caps at maxHp', () => {
    useGameStore.setState((s) => {
      const p = s.fight.player
      p.hp = p.maxHp - 1
      s.runPhase = 'rest'
    })
    useGameStore.getState().restHeal()
    const p = useGameStore.getState().fight.player
    expect(p.hp).toBe(p.maxHp)
  })

  it('restUpgrade marks the named relic as upgraded', () => {
    useGameStore.setState((s) => {
      s.fight.player.relics.push({
        id: 'iron-buckler',
        runFlags: {},
        fightFlags: {},
      })
      s.runPhase = 'rest'
    })
    const result = useGameStore.getState().restUpgrade('iron-buckler')
    expect(result.ok).toBe(true)
    const inst = useGameStore.getState().fight.player.relics.find((r) => r.id === 'iron-buckler')
    expect(inst?.upgraded).toBe(true)
    expect(useGameStore.getState().runPhase).toBe('map')
  })

  it('restUpgrade refuses non-upgradable relics', () => {
    useGameStore.setState((s) => {
      s.fight.player.relics.push({
        id: 'stoneheart',
        runFlags: {},
        fightFlags: {},
      })
      s.runPhase = 'rest'
    })
    const result = useGameStore.getState().restUpgrade('stoneheart')
    expect(result.ok).toBe(false)
    const inst = useGameStore.getState().fight.player.relics.find((r) => r.id === 'stoneheart')
    expect(inst?.upgraded).toBeUndefined()
    // Stays on rest screen since pick failed.
    expect(useGameStore.getState().runPhase).toBe('rest')
  })

  it('restUpgrade refuses already-upgraded relic', () => {
    useGameStore.setState((s) => {
      s.fight.player.relics.push({
        id: 'iron-buckler',
        runFlags: {},
        fightFlags: {},
        upgraded: true,
      })
      s.runPhase = 'rest'
    })
    const result = useGameStore.getState().restUpgrade('iron-buckler')
    expect(result.ok).toBe(false)
  })

  it('actions no-op when not on the rest screen', () => {
    useGameStore.setState((s) => {
      s.runPhase = 'map'
    })
    expect(useGameStore.getState().restHeal().ok).toBe(false)
    expect(useGameStore.getState().restUpgrade('iron-buckler').ok).toBe(false)
  })

  it('leaveRest returns to map without marking the node visited', () => {
    useGameStore.setState((s) => {
      s.runPhase = 'rest'
      s.map.currentNodeId = 'col4-rest'
      s.map.completedNodeIds = []
    })
    useGameStore.getState().leaveRest()
    expect(useGameStore.getState().runPhase).toBe('map')
    expect(useGameStore.getState().map.completedNodeIds).toEqual([])
  })
})
