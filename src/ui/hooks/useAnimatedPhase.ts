import { useEffect, useState } from 'react'
import { subscribeGameEvents } from '../../core/events/emitter'
import { useGameStore } from '../../core/state/store'
import type { CombatPhase } from '../../types'

// Logical state updates synchronously inside attemptSwap, but animations
// drain over time. Reading `fight.phase` from the store therefore reflects
// the *final* phase before animations even start. This hook returns the
// phase the *animation* is currently in, by listening to `phase-changed`
// events on the same bus AnimationController uses. UI that needs to sync
// with the visible turn rhythm (badge visibility, phase banner) reads
// this instead of the store directly.
//
// Fight-reset reseed: enterNode / restart bump `fightCounter` but DO NOT
// emit `phase-changed` (the transition from 'victory' → fresh
// 'player-acting' happens via store assignment, not through the combat
// pipeline). Without the reseed below, a new fight against the same
// enemy type would start with the prior fight's terminal phase still
// latched in local state — the intent badge stays hidden until the
// FIRST swap, because showIntent gates on animatedPhase ===
// 'player-acting'.
export function useAnimatedPhase(): CombatPhase {
  const storePhase = useGameStore((s) => s.fight.phase)
  const [phase, setPhase] = useState<CombatPhase>(storePhase)

  useEffect(() => {
    return subscribeGameEvents((event) => {
      if (event.kind === 'phase-changed') setPhase(event.phase)
    })
  }, [])

  // Reseed from canonical store on every fightCounter bump. Reads via
  // useGameStore.subscribe so we don't re-subscribe per phase-state
  // change. Mirrors EnemyFrame's render-phase fightCounter resync.
  const fightCounter = useGameStore((s) => s.fightCounter)
  const [trackedCounter, setTrackedCounter] = useState(fightCounter)
  if (trackedCounter !== fightCounter) {
    setTrackedCounter(fightCounter)
    setPhase(storePhase)
  }

  return phase
}
