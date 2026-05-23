import { useEffect, useState } from 'react'
import { subscribeGameEvents } from '../../core/events/emitter'

// Off-screen aria-live regions. Two channels so urgent events (damage,
// victory) don't queue behind ambient ones. Per-match damage-dealt is
// skipped to avoid spamming during cascades.

// Identical-string updates don't trigger re-announcement in most ATs;
// toggling a trailing space gives every emit a fresh diff.
const bump = (prev: string, text: string): string =>
  prev === text ? `${text} ` : text

export function AriaLiveAnnouncer() {
  const [polite, setPolite] = useState('')
  const [assertive, setAssertive] = useState('')

  useEffect(
    () =>
      subscribeGameEvents((event) => {
        switch (event.kind) {
          case 'damage-taken':
            if (event.amount > 0)
              setAssertive((p) => bump(p, `Took ${event.amount} damage`))
            else if (event.blocked > 0)
              setPolite((p) => bump(p, `Blocked ${event.blocked}`))
            return
          case 'healed':
            if (event.amount > 0) setPolite((p) => bump(p, `Healed ${event.amount}`))
            return
          case 'enemy-killed':
            setPolite((p) => bump(p, 'Enemy defeated'))
            return
          case 'phase-changed':
            if (event.phase === 'victory') setAssertive((p) => bump(p, 'Victory'))
            else if (event.phase === 'game-over')
              setAssertive((p) => bump(p, 'Defeated'))
            return
          case 'extra-turn-granted':
            setPolite((p) => bump(p, 'Bonus turn'))
            return
        }
      }),
    [],
  )

  return (
    <>
      <div className="sr-only" aria-live="assertive" aria-atomic="true">
        {assertive}
      </div>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {polite}
      </div>
    </>
  )
}
