import { describe, expect, it, beforeEach } from 'vitest'
import '../../content/enemies'
import '../../content/spells'
import '../../content/relics'
import '../../content/statuses'
import { useGameStore } from './store'

// Regression test (2026-05-25): user reported spells could be cast
// without sufficient mana. Confirm every cast path refuses on
// insufficient mana and leaves player.mana untouched.

function reset() {
  useGameStore.getState().restart()
  // Enter a real fight so target-required spells (Ignite/Brittle/Cinder
  // Lash/Volley) can be tested. Find any fight node from the map.
  const fightNode = useGameStore
    .getState()
    .map.nodes.find((n) => n.column === 0 && n.kind === 'fight')
  if (fightNode) useGameStore.getState().enterNode(fightNode.id)
  useGameStore.setState((s) => {
    s.fight.phase = 'player-acting'
    s.fight.player.mana = { red: 0, blue: 0, green: 0, yellow: 0 }
    s.fight.player.skillCharge = 0
    s.fight.player.pendingSpells = []
    s.fight.player.statuses = [{ kind: 'burn', stacks: 2 }]
    // Make sure the first enemy is targeted (enterNode already does this
    // but make it explicit so any future store change can't break this).
    s.fight.targetEnemyId = s.fight.enemies[0]?.id ?? null
  })
}

describe('cast gates: insufficient mana refuses the cast', () => {
  beforeEach(reset)

  it('castSpell(bulwark) fails with no blue / no yellow', () => {
    const res = useGameStore.getState().castSpell('bulwark')
    expect(res.ok).toBe(false)
    expect(useGameStore.getState().fight.player.mana).toEqual({
      red: 0,
      blue: 0,
      green: 0,
      yellow: 0,
    })
  })

  it('castSpell(reinforce) fails with 3 blue (needs 4)', () => {
    useGameStore.setState((s) => {
      s.fight.player.mana.blue = 3
    })
    const res = useGameStore.getState().castSpell('reinforce')
    expect(res.ok).toBe(false)
    expect(useGameStore.getState().fight.player.mana.blue).toBe(3)
  })

  it('castSpell(ignite) fails with 2 red (needs 3)', () => {
    useGameStore.setState((s) => {
      s.fight.player.mana.red = 2
    })
    const res = useGameStore.getState().castSpell('ignite')
    expect(res.ok).toBe(false)
    expect(useGameStore.getState().fight.player.mana.red).toBe(2)
  })

  it('castSpell(regenerate) fails with 2 green (needs 3)', () => {
    useGameStore.setState((s) => {
      s.fight.player.mana.green = 2
    })
    const res = useGameStore.getState().castSpell('regenerate')
    expect(res.ok).toBe(false)
    expect(useGameStore.getState().fight.player.statuses).not.toContainEqual({
      kind: 'regen',
      stacks: 3,
    })
  })

  it('castSpell(skewer) fails with 1 red (needs 2)', () => {
    useGameStore.setState((s) => {
      s.fight.player.mana.red = 1
    })
    const res = useGameStore.getState().castSpell('skewer')
    expect(res.ok).toBe(false)
    expect(useGameStore.getState().fight.player.skewerArmed).toBeUndefined()
  })

  it('castSpell(brittle) fails with 2 blue (needs 3)', () => {
    useGameStore.setState((s) => {
      s.fight.player.mana.blue = 2
    })
    const res = useGameStore.getState().castSpell('brittle')
    expect(res.ok).toBe(false)
  })

  it('castSpell(surge) fails with 2 yellow (needs 3)', () => {
    useGameStore.setState((s) => {
      s.fight.player.mana.yellow = 2
    })
    const res = useGameStore.getState().castSpell('surge')
    expect(res.ok).toBe(false)
    expect(useGameStore.getState().fight.player.surgeArmed).toBeUndefined()
  })

  it('castSpell(cinder-lash) fails with only 2 red (needs 2R + 1G)', () => {
    useGameStore.setState((s) => {
      s.fight.player.mana.red = 2
    })
    const res = useGameStore.getState().castSpell('cinder-lash')
    expect(res.ok).toBe(false)
  })

  it('castSpell(cinder-lash) succeeds with 2R + 1G (exact)', () => {
    useGameStore.setState((s) => {
      s.fight.player.mana = { red: 2, blue: 0, green: 1, yellow: 0 }
    })
    const res = useGameStore.getState().castSpell('cinder-lash')
    expect(res.ok).toBe(true)
    expect(useGameStore.getState().fight.player.mana).toEqual({
      red: 0,
      blue: 0,
      green: 0,
      yellow: 0,
    })
  })

  it('castFocus fails with insufficient yellow (explicit cost — no wild substitution)', () => {
    useGameStore.setState((s) => {
      s.fight.player.mana = { red: 8, blue: 8, green: 8, yellow: 1 }
    })
    const res = useGameStore.getState().castFocus('red', 'blue')
    expect(res.ok).toBe(false)
    // Mana unchanged.
    expect(useGameStore.getState().fight.player.mana).toEqual({
      red: 8,
      blue: 8,
      green: 8,
      yellow: 1,
    })
  })

  it('castPurify fails with 1 green (needs 2)', () => {
    useGameStore.setState((s) => {
      s.fight.player.mana.green = 1
    })
    const res = useGameStore.getState().castPurify('burn')
    expect(res.ok).toBe(false)
    // Burn status still present.
    expect(useGameStore.getState().fight.player.statuses).toContainEqual({
      kind: 'burn',
      stacks: 2,
    })
  })

  it('castVolley fails with 3 red (needs 4)', () => {
    useGameStore.setState((s) => {
      s.fight.player.mana.red = 3
    })
    const targets = useGameStore
      .getState()
      .fight.enemies.slice(0, 1)
      .map((e) => e.id)
    if (targets.length === 0) return
    const res = useGameStore
      .getState()
      .castVolley([targets[0]!, targets[0]!, targets[0]!])
    expect(res.ok).toBe(false)
    expect(useGameStore.getState().fight.player.pendingSpells).not.toContain(
      'volley',
    )
  })
})

describe('wild substitution: yellow covers shortfall correctly', () => {
  beforeEach(reset)

  it('castSpell(bulwark) succeeds with 2 blue + 1 yellow', () => {
    useGameStore.setState((s) => {
      s.fight.player.mana = { red: 0, blue: 2, green: 0, yellow: 1 }
    })
    const res = useGameStore.getState().castSpell('bulwark')
    expect(res.ok).toBe(true)
    expect(useGameStore.getState().fight.player.mana).toEqual({
      red: 0,
      blue: 0,
      green: 0,
      yellow: 0,
    })
  })

  it('castSpell(bulwark) fails with 2 blue + 0 yellow (1 short)', () => {
    useGameStore.setState((s) => {
      s.fight.player.mana = { red: 0, blue: 2, green: 0, yellow: 0 }
    })
    const res = useGameStore.getState().castSpell('bulwark')
    expect(res.ok).toBe(false)
    expect(useGameStore.getState().fight.player.mana).toEqual({
      red: 0,
      blue: 2,
      green: 0,
      yellow: 0,
    })
  })

  it('castSpell(cinder-lash) wild substitution: 1R + 1G + 1Y covers 2R+1G', () => {
    useGameStore.setState((s) => {
      s.fight.player.mana = { red: 1, blue: 0, green: 1, yellow: 1 }
    })
    const res = useGameStore.getState().castSpell('cinder-lash')
    expect(res.ok).toBe(true)
    // Spent 1R + 1G exact + 1Y for the red shortfall.
    expect(useGameStore.getState().fight.player.mana).toEqual({
      red: 0,
      blue: 0,
      green: 0,
      yellow: 0,
    })
  })
})
