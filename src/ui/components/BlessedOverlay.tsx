import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useGameStore } from '../../core/state/store'
import { subscribeGameEvents } from '../../core/events/emitter'
import { useAnimatedCellPositions } from '../hooks/useAnimatedCellPositions'
import { useBoardWipe } from '../hooks/useBoardWipe'
import { useFightReset } from '../hooks/useFightReset'
import { CellAnchor } from './CellAnchor'

// Animation-timed overlay for the `blessed` cell flag (match-5 reward).
// Mirrors BurningOverlay's pattern but simpler — blessed is a 1-bit flag
// (present or absent), no duration / no fizzle. See
// PLANNING/01-design.md §Blessed cells.
//
// Lifecycle:
//   - tile-blessed-placed:      add an entry at each listed cell.
//   - blessed-match-triggered:  the listed cells just cleared, so drop them
//                               from the overlay (the gold rim vanishes with
//                               the matched gem).
//   - board-wipe (shuffle/sweep): clear all (handled via useBoardWipe).
//   - fight reset:              reseed from store (new fight = fresh board).
//
// Position tracking lives in useAnimatedCellPositions so the rim slides in
// lockstep with the gem sprite underneath during swap / gravity.

// Per-sparkle randomized look. Position is a % within the cell (left/top
// of the sparkle's bounding box), delay and duration vary so adjacent
// blessed cells never tick in sync. Each iteration of the drift
// animation re-rolls left/top via `animationiteration` (see
// BlessedSpark below), so a single gem doesn't keep showing sparkles at
// the same three spots every cycle.
type SparkConfig = {
  left: number
  top: number
  delay: number
  duration: number
}
const SPARKS_PER_CELL = 3

// Position bounds tuned for the gem's silhouette: ~15% inset from cell
// edges (so sparkles don't ride into neighbour cells), with a Y bias
// toward the lower half so the upward drift reads as "energy rising
// from the gem" rather than "ambient dust above it".
function randomSparkPos(): { left: number; top: number } {
  return {
    left: 15 + Math.random() * 70,
    top: 35 + Math.random() * 50,
  }
}
function randomSparks(): SparkConfig[] {
  const out: SparkConfig[] = []
  for (let i = 0; i < SPARKS_PER_CELL; i++) {
    const p = randomSparkPos()
    out.push({
      ...p,
      // Stagger across a window slightly longer than the per-spark
      // duration so they're never all peaking together.
      delay: -Math.random() * 2.6,
      duration: 2.0 + Math.random() * 0.9,
    })
  }
  return out
}

// Single sparkle. Listens for `animationiteration` on its own element to
// re-roll position via direct DOM mutation between loops — purely
// cosmetic, no React state, no re-render. Position changes happen at
// opacity:0 (the keyframe's 0% state), so the player never sees a sparkle
// teleport mid-flight.
function BlessedSpark({ initial }: { initial: SparkConfig }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onIter = () => {
      const p = randomSparkPos()
      el.style.left = `${p.left.toFixed(2)}%`
      el.style.top = `${p.top.toFixed(2)}%`
    }
    el.addEventListener('animationiteration', onIter)
    return () => el.removeEventListener('animationiteration', onIter)
  }, [])
  return (
    <span
      ref={ref}
      className="blessed-spark"
      style={{
        left: `${initial.left.toFixed(2)}%`,
        top: `${initial.top.toFixed(2)}%`,
        animationDelay: `${initial.delay.toFixed(2)}s`,
        animationDuration: `${initial.duration.toFixed(2)}s`,
      }}
    >
      ✦
    </span>
  )
}

export function BlessedOverlay() {
  const positions = useAnimatedCellPositions()
  const [sparks, setSparks] = useState<Map<string, SparkConfig[]>>(new Map())
  const idCounterRef = useRef(0)

  useLayoutEffect(() => {
    setSparks(seedBlessedFromStore(positions.set, idCounterRef))
    // Intentionally one-shot. Fight resets are handled by the subscription
    // below; positions is a stable ref-API object so it doesn't re-trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const wipeAll = useCallback(() => {
    positions.clear()
    setSparks(new Map())
  }, [positions])

  useFightReset(
    useCallback(() => {
      wipeAll()
      setSparks(seedBlessedFromStore(positions.set, idCounterRef))
    }, [wipeAll, positions]),
  )

  useBoardWipe(wipeAll)

  useEffect(() => {
    return subscribeGameEvents((event) => {
      if (event.kind === 'tile-blessed-placed') {
        // tile-blessed-placed fires AFTER gems-spawned in the cascade
        // event stream, so the cells are already at their final
        // post-cascade positions when this beat plays. No trail-arrival
        // delay needed (unlike tile-burn-placed, which has to wait for
        // ember particles to fly from the enemy frame to the cells).
        const placed: { id: string; sparks: SparkConfig[] }[] = []
        for (const c of event.cells) {
          const id = `bless-${++idCounterRef.current}`
          positions.set(id, c.x, c.y)
          placed.push({ id, sparks: randomSparks() })
        }
        if (placed.length === 0) return
        setSparks((prev) => {
          const next = new Map(prev)
          for (const p of placed) next.set(p.id, p.sparks)
          return next
        })
      } else if (event.kind === 'blessed-match-triggered') {
        // Gems carrying the flag just got matched — drop them from the
        // overlay so the gold rim vanishes with the gem (rather than
        // hovering over a now-cleared cell).
        const removed: string[] = []
        for (const c of event.cells) {
          const id = positions.findIdAt(c.x, c.y)
          if (!id) continue
          positions.remove(id)
          removed.push(id)
        }
        if (removed.length === 0) return
        setSparks((prev) => {
          const next = new Map(prev)
          for (const id of removed) next.delete(id)
          return next
        })
      }
    })
  }, [positions])

  return (
    <div className="blessed-overlay" aria-hidden>
      {Array.from(positions.positions.entries()).map(([id, p]) => {
        const cellSparks = sparks.get(id)
        if (!cellSparks) return null
        return (
          <CellAnchor
            key={id}
            x={p.x}
            y={p.y}
            transition={p.transition}
            className="blessed-cell"
          >
            {cellSparks.map((s, i) => (
              <BlessedSpark key={i} initial={s} />
            ))}
          </CellAnchor>
        )
      })}
    </div>
  )
}

function seedBlessedFromStore(
  setPosition: (id: string, x: number, y: number) => void,
  idCounterRef: { current: number },
): Map<string, SparkConfig[]> {
  const s = useGameStore.getState()
  const out = new Map<string, SparkConfig[]>()
  for (let y = 0; y < s.board.cells.length; y++) {
    const row = s.board.cells[y]
    if (!row) continue
    for (let x = 0; x < row.length; x++) {
      if (row[x]?.flags?.blessed) {
        const id = `bless-${++idCounterRef.current}`
        setPosition(id, x, y)
        out.set(id, randomSparks())
      }
    }
  }
  return out
}
