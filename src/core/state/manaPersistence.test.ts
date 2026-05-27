import { describe, expect, it } from 'vitest'
import '../../content/enemies'
import '../../content/spells'
import '../../content/relics'
import '../../content/statuses'
import { useGameStore } from './store'

// Original H3 design carried mana over between fights. In playtesting
// that let players bank mana through trivial fights and arrive at
// later ones with a full kit, which trivialised pacing. Per-fight
// reset puts every encounter on the same starting line. Same
// reasoning extends to restart (always reset) and skill charge
// (which already reset per fight).

function setMana(red: number, blue: number, green: number, yellow: number) {
  useGameStore.setState((s) => {
    s.fight.player.mana = { red, blue, green, yellow }
  })
}

function setSkillCharge(charge: number) {
  useGameStore.setState((s) => {
    s.fight.player.skillCharge = charge
  })
}

describe('mana resets on each new fight', () => {
  it('zeros mana when entering a fight node', () => {
    // Reset to a clean run.
    useGameStore.getState().restart()
    // Hand-seed some mana on the lingering fight state.
    setMana(3, 5, 2, 4)

    // Find a fight node reachable from the start of the map.
    const map = useGameStore.getState().map
    const startFight = map.nodes.find(
      (n) => n.column === 0 && n.kind === 'fight',
    )
    expect(startFight).toBeDefined()

    useGameStore.getState().enterNode(startFight!.id)

    const mana = useGameStore.getState().fight.player.mana
    expect(mana).toEqual({ red: 0, blue: 0, green: 0, yellow: 0 })
    expect(useGameStore.getState().fight.player.skillCharge).toBe(0)
  })

  it('zeros skill charge when entering a fight node', () => {
    useGameStore.getState().restart()
    setSkillCharge(6)

    const map = useGameStore.getState().map
    const startFight = map.nodes.find(
      (n) => n.column === 0 && n.kind === 'fight',
    )
    expect(startFight).toBeDefined()

    useGameStore.getState().enterNode(startFight!.id)

    expect(useGameStore.getState().fight.player.skillCharge).toBe(0)
  })

  it('wipes mana and skill charge on restart', () => {
    setMana(3, 5, 2, 4)
    setSkillCharge(6)
    useGameStore.getState().restart()
    const mana = useGameStore.getState().fight.player.mana
    expect(mana).toEqual({ red: 0, blue: 0, green: 0, yellow: 0 })
    expect(useGameStore.getState().fight.player.skillCharge).toBe(0)
  })
})
