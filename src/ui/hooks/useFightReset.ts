import { useEffect, useRef } from 'react'
import { useGameStore } from '../../core/state/store'

// Fires `onReset` every time the fightCounter increments (new fight via
// reward, skip, or restart). The callback typically wipes existing
// decorations AND reseeds from the new board's state — that combined
// behavior is caller-specific, so it lives here as a single callback
// instead of split into onWipe/onSeed.
//
// Initial mount seeding is the caller's responsibility (usually a
// `useLayoutEffect` so a save-reloaded fight paints its decorations on
// the first frame).
//
// The callback is captured via a ref so the subscription doesn't churn
// when the caller passes an inline function.

export function useFightReset(onReset: () => void): void {
  const cbRef = useRef(onReset)
  useEffect(() => {
    cbRef.current = onReset
  }, [onReset])

  useEffect(() => {
    let prev = useGameStore.getState().fightCounter
    return useGameStore.subscribe((s) => {
      if (s.fightCounter === prev) return
      prev = s.fightCounter
      cbRef.current()
    })
  }, [])
}
