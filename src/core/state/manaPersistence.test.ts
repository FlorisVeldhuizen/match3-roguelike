import { describe, expect, it } from 'vitest'
import '../../content/enemies'
import '../../content/spells'
import '../../content/relics'
import '../../content/statuses'
import { useGameStore } from './store'

// H3: mana persists across fight transitions but is wiped on restart.
// Locked by 08-multi-color-mana-proposal.md — without persistence,
// stockpiling mana between fights becomes impossible and walking into a
// shop drops your saved-up resources.

function setMana(red: number, blue: number, green: number, yellow: number) {
  useGameStore.setState((s) => {
    s.fight.player.mana = { red, blue, green, yellow }
  })
}

describe('mana persistence across fights', () => {
  it('carries mana when entering a new fight node', () => {
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
    expect(mana).toEqual({ red: 3, blue: 5, green: 2, yellow: 4 })
  })

  it('wipes mana on restart', () => {
    setMana(3, 5, 2, 4)
    useGameStore.getState().restart()
    const mana = useGameStore.getState().fight.player.mana
    expect(mana).toEqual({ red: 0, blue: 0, green: 0, yellow: 0 })
  })
})
