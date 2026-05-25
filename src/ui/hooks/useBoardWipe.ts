import { useEffect, useRef } from 'react'
import { subscribeGameEvents } from '../../core/events/emitter'

// Fires `onWipe` whenever the board is wholesale-reset and every
// cell-anchored decoration should be cleared:
//   - board-shuffled: mid-fight reshuffle wipes all per-cell flags.
//   - board-swept:    fight-end sweep drops every gem off-screen.
//
// Fight-counter changes (new fight via reward / skip / restart) are NOT
// included — those usually also want a re-seed from store, which is
// caller-specific. Pair this with `useFightReset` for that.
//
// The callback is captured via a ref so the subscription doesn't churn
// when the caller passes an inline function.

export function useBoardWipe(onWipe: () => void): void {
  const cbRef = useRef(onWipe)
  useEffect(() => {
    cbRef.current = onWipe
  }, [onWipe])

  useEffect(() => {
    return subscribeGameEvents((event) => {
      if (event.kind === 'board-shuffled' || event.kind === 'board-swept') {
        cbRef.current()
      }
    })
  }, [])
}
