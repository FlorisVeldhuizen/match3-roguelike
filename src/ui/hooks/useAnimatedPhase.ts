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
export function useAnimatedPhase(): CombatPhase {
  const storePhase = useGameStore((s) => s.fight.phase)
  const [phase, setPhase] = useState<CombatPhase>(storePhase)

  useEffect(() => {
    return subscribeGameEvents((event) => {
      if (event.kind === 'phase-changed') setPhase(event.phase)
    })
  }, [])

  return phase
}
