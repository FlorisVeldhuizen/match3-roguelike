import { useEffect, useState } from 'react'
import { subscribeGameEvents } from '../../core/events/emitter'
import { useGameStore } from '../../core/state/store'
import type { CombatPhase } from '../../types'

export function useAnimatedPhase(): CombatPhase {
  const storePhase = useGameStore((s) => s.fight.phase)
  const [phase, setPhase] = useState<CombatPhase>(storePhase)

  useEffect(() => {
    return subscribeGameEvents((event) => {
      if (event.kind === 'phase-changed') setPhase(event.phase)
    })
  }, [])

  const fightCounter = useGameStore((s) => s.fightCounter)
  const [trackedCounter, setTrackedCounter] = useState(fightCounter)
  if (trackedCounter !== fightCounter) {
    setTrackedCounter(fightCounter)
    setPhase(storePhase)
  }

  return phase
}
