import { useEffect, useState } from 'react'
import { subscribeGameEvents } from '../../core/events/emitter'

// Tracks whether the board is currently animating (cascades drained,
// pool-gained trails landed, EOP swing finished, etc). True = settled,
// false = something is still in flight.
//
// The store's `fight.phase` flips to 'player-acting' synchronously
// inside attemptSwap before any animation runs, so it can't be used as
// a "ready to cast" signal. BoardScene fires `gameplay-settled` after
// AnimationController fully drains AND a short cushion has elapsed
// (covers trail-arrival delays for the mana chips). Until that lands,
// any displayed mana number visibly lags the store and the player
// can't trust the spell-tray affordability gate.
//
// Used by SpellTray to disable cast buttons during the lag window:
// the display has caught up the moment we report settled=true again.
// See 01-design §Spell-timing rule ("board settled" prerequisite).
//
// Initial state is true — at app boot, no animation is running. Any
// further events flip it.
export function useBoardSettled(): boolean {
  const [settled, setSettled] = useState(true)

  useEffect(() => {
    return subscribeGameEvents((event) => {
      // Anything that starts an animated beat unsettles the board.
      // `swap` is the player's input; subsequent matches/cascades/EOP
      // all emit pool-gained / damage-dealt / etc, but the swap is
      // always the leading edge. Same for `swap-reverted` (the bounce-
      // back tween is still an animation).
      if (event.kind === 'swap' || event.kind === 'swap-reverted') {
        setSettled(false)
      } else if (event.kind === 'gameplay-settled') {
        setSettled(true)
      }
    })
  }, [])

  return settled
}
