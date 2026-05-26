import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from 'react'
import { useGameStore } from '../../core/state/store'
import { subscribeGameEvents } from '../../core/events/emitter'
import { TRAIL_ARRIVAL_MS } from '../../timing'
import { useFightReset } from '../hooks/useFightReset'
import { BOARD_HEIGHT, BOARD_WIDTH } from '../../types'
import type { GemColor } from '../../types'
import { CellAnchor } from './CellAnchor'

// H2c threat visualization for Caster's color-hex board verb. Event-
// driven (not direct store read) so the ring "lands" when the arcane
// particle trail spawned by AnimationController for color-hex-fired
// arrives at the gems — the visual treatment shouldn't beat the
// particles to their destination.
//
// Lifecycle:
//   - color-hex-fired:  schedule colour to enter `activeColors` at
//                       TRAIL_ARRIVAL_MS (fightCounter-guarded so a
//                       stale timeout can't leak into a fresh fight).
//   - color-hex-ticked: when `remaining > 0`, update turnsLeft (drives
//                       the `is-weakening` treatment on the final
//                       turn). When `remaining === 0`, enter
//                       `is-expiring` state for FIZZLE_MS then drop —
//                       same fade-out pattern Burn / Petrify use.
//   - fight reset:      reset local state + reseed from store.
//
// We still read `board.cells` from the store on render — gems shuffle
// under cascades and gravity, and the "every gem of colour X is
// hexed" rule has to follow whichever cells currently carry that
// colour. The activeColors *map* is the event-timed surface; the
// per-cell rendering is store-derived.

type HexState = { turnsLeft: number; expiring: boolean }

// Hex fade-out window after the entry ticks to 0 — the ring softens
// and shrinks during this window before the cells finally clear.
// Matches the BurningOverlay's FIZZLE_MS so all three board verbs
// (burn / petrify / hex) share the same "passed without firing" beat
// timing.
const FIZZLE_MS = 1200

export function ColorHexOverlay() {
  const [hexStates, setHexStates] = useState<Map<GemColor, HexState>>(new Map())
  const cells = useGameStore((s) => s.board.cells)

  // Initial seed + fight-reset seed. The store's hexedColors is the
  // canonical post-resolve snapshot, so seeding from it gives us the
  // current active set + turnsLeft. The "but particles haven't
  // arrived yet" concern doesn't apply at mount — we're catching up
  // to an existing fight.
  const seedFromStore = useCallback(() => {
    const s = useGameStore.getState()
    const next = new Map<GemColor, HexState>()
    for (const h of s.fight.hexedColors ?? []) {
      next.set(h.color, { turnsLeft: h.turnsLeft, expiring: false })
    }
    setHexStates(next)
  }, [])

  useLayoutEffect(() => {
    seedFromStore()
  }, [seedFromStore])

  useFightReset(
    useCallback(() => {
      setHexStates(new Map())
      seedFromStore()
    }, [seedFromStore]),
  )

  useEffect(() => {
    return subscribeGameEvents((event) => {
      if (event.kind === 'color-hex-fired') {
        const color = event.color
        const turnsLeft = event.turnsLeft
        const scheduledFight = useGameStore.getState().fightCounter
        window.setTimeout(() => {
          if (useGameStore.getState().fightCounter !== scheduledFight) return
          setHexStates((prev) => {
            const next = new Map(prev)
            // Always overwrite — re-applying the same colour refreshes
            // turnsLeft AND clears any in-progress expiring state.
            next.set(color, { turnsLeft, expiring: false })
            return next
          })
        }, TRAIL_ARRIVAL_MS)
      } else if (event.kind === 'color-hex-ticked') {
        const color = event.color
        const remaining = event.remaining
        if (remaining > 0) {
          // Update turnsLeft so the cells flip into the `is-weakening`
          // treatment on the final phase.
          setHexStates((prev) => {
            if (!prev.has(color)) return prev
            const next = new Map(prev)
            next.set(color, { turnsLeft: remaining, expiring: false })
            return next
          })
        } else {
          // remaining === 0: enter expiring state for the fade window,
          // then drop the entry entirely. fightCounter-guarded so a
          // stale timeout doesn't leak into a fresh fight.
          const scheduledFight = useGameStore.getState().fightCounter
          setHexStates((prev) => {
            if (!prev.has(color)) return prev
            const next = new Map(prev)
            next.set(color, { turnsLeft: 0, expiring: true })
            return next
          })
          window.setTimeout(() => {
            if (useGameStore.getState().fightCounter !== scheduledFight) return
            setHexStates((prev) => {
              if (!prev.has(color)) return prev
              const cur = prev.get(color)
              // If a fresh hex came in during the fade, leave it alone.
              if (!cur?.expiring) return prev
              const next = new Map(prev)
              next.delete(color)
              return next
            })
          }, FIZZLE_MS)
        }
      }
    })
  }, [])

  if (hexStates.size === 0) return null

  const anchors: ReactNode[] = []
  for (let y = 0; y < BOARD_HEIGHT; y++) {
    const row = cells[y]
    if (!row) continue
    for (let x = 0; x < BOARD_WIDTH; x++) {
      const cell = row[x]
      if (!cell) continue
      const state = hexStates.get(cell.gemColor)
      if (!state) continue
      // Visual escalation:
      //   active (default)     — full ring + pulse
      //   active + weakening   — final turn before expiry; softened
      //   expiring             — fade-out window after tick to 0
      const cls = state.expiring
        ? 'color-hex-cell is-expiring'
        : state.turnsLeft <= 1
          ? 'color-hex-cell active is-weakening'
          : 'color-hex-cell active'
      anchors.push(<CellAnchor key={`hex-${x}-${y}`} x={x} y={y} className={cls} />)
    }
  }

  return (
    <div className="color-hex-overlay" aria-hidden>
      {anchors}
    </div>
  )
}
