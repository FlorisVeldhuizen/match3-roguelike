import { useEffect, useRef, useState } from 'react'
import { useGameStore } from '../../core/state/store'
import { subscribeGameEvents } from '../../core/events/emitter'
import { TRAIL_ARRIVAL_MS } from '../../timing'
import type { Pos } from '../../types'

// Animation-timed overlay. We deliberately do NOT mirror s.board.cells:
// that state commits at swap time (before the cascade animates), which
// would yank the flame off-screen before the gem itself even clears.
// Instead we drive the displayed flames off animation-timed events:
//   - tile-burn-placed:   add flames at the listed cells (Bleeder's verb).
//   - tile-burn-triggered: spawn a burst at the cleared cells, then drop
//                          them from the displayed set after the burst.
//   - cell-flag-ticked / 'burning': decrement the visible countdown so
//     the number on each flame matches the game state.
// We also resync the full set from the store on restart (rootSeed flip).
//
// The overlay sits INSIDE .board-mount with a small percentage inset
// (BOARD_PADDING / LOGICAL_SIZE = 8/528 ≈ 1.515%) so the 8×8 grid lines
// up with the gem grid inside the Pixi canvas — not with the canvas
// edge.

type Flame = { x: number; y: number; remaining: number }
type Burst = { id: number; x: number; y: number }

const BURST_MS = 720

const keyOf = (p: Pos) => `${p.x},${p.y}`

export function BurningOverlay() {
  const rootSeed = useGameStore((s) => s.rootSeed)
  // Lazy initializer reads the store once at mount; matches the store
  // state for that first frame without firing a setState in an effect.
  const [flames, setFlames] = useState<Map<string, Flame>>(() =>
    initialFlamesFromStore(),
  )
  const [bursts, setBursts] = useState<Burst[]>([])
  const burstIdRef = useRef(0)

  // Resync on restart. Subscribe handler is on the "external system
  // update" side of React's effect rules — no setState in the effect
  // body itself.
  useEffect(() => {
    let prevSeed = rootSeed
    return useGameStore.subscribe((s) => {
      if (s.rootSeed === prevSeed) return
      prevSeed = s.rootSeed
      setFlames(initialFlamesFromStore())
      setBursts([])
    })
  }, [rootSeed])

  useEffect(() => {
    return subscribeGameEvents((event) => {
      if (event.kind === 'tile-burn-placed') {
        const burning = burnDurationFromStore()
        const cells = event.cells
        // Delay flame appearance to the trail-arrival beat — the
        // AnimationController spawns ember particles from the enemy
        // to each cell, and the flame should "ignite" when those
        // particles land, not the instant the event fires.
        window.setTimeout(() => {
          setFlames((prev) => {
            const next = new Map(prev)
            for (const c of cells) {
              next.set(keyOf(c), { x: c.x, y: c.y, remaining: burning })
            }
            return next
          })
        }, TRAIL_ARRIVAL_MS)
      } else if (event.kind === 'tile-burn-triggered') {
        // Spawn a burst at each cell, then strip those flames so they
        // resolve visually rather than vanishing on store commit.
        const newBursts: Burst[] = event.cells.map((c) => ({
          id: ++burstIdRef.current,
          x: c.x,
          y: c.y,
        }))
        setBursts((prev) => [...prev, ...newBursts])
        setFlames((prev) => {
          const next = new Map(prev)
          for (const c of event.cells) next.delete(keyOf(c))
          return next
        })
        const ids = new Set(newBursts.map((b) => b.id))
        window.setTimeout(() => {
          setBursts((prev) => prev.filter((b) => !ids.has(b.id)))
        }, BURST_MS)
      } else if (event.kind === 'cell-flag-ticked' && event.flag === 'burning') {
        // End-of-player-phase tick reduces remaining duration by 1.
        setFlames((prev) => {
          const next = new Map(prev)
          for (const p of event.positions) {
            const k = keyOf(p)
            const cur = next.get(k)
            if (!cur) continue
            const r = cur.remaining - 1
            if (r <= 0) next.delete(k)
            else next.set(k, { ...cur, remaining: r })
          }
          return next
        })
      } else if (event.kind === 'gems-fell') {
        // Gravity preserves Cell identity (gemColor + flags fall
        // together — see core/board/gravity.ts). The overlay tracks
        // flames by position, so without this they'd stay glued to the
        // original cell while the burning gem slid down out from under
        // them. Re-key each affected flame to its new position.
        setFlames((prev) => {
          let changed = false
          const next = new Map(prev)
          // Two-step: collect destinations first so a chain of moves
          // (a → b, b → c) doesn't overwrite intermediate flames. The
          // cascade emits a single gems-fell per step with disjoint
          // sources/destinations, so simple key-swap is enough here.
          const pending: { from: string; to: string; flame: Flame }[] = []
          for (const m of event.movements) {
            const fromK = keyOf(m.from)
            const flame = prev.get(fromK)
            if (!flame) continue
            pending.push({
              from: fromK,
              to: keyOf(m.to),
              flame: { ...flame, x: m.to.x, y: m.to.y },
            })
          }
          for (const p of pending) {
            next.delete(p.from)
            changed = true
          }
          for (const p of pending) {
            next.set(p.to, p.flame)
            changed = true
          }
          return changed ? next : prev
        })
      } else if (event.kind === 'cascade-complete') {
        // Safety net: after a full cascade resolves, re-sync from the
        // committed board. Catches any drift (e.g. a flag we missed
        // moving, or a reshuffle from a deadlocked board) without
        // forcing the overlay to mirror store state during play.
        setFlames(initialFlamesFromStore())
      } else if (event.kind === 'board-shuffled') {
        // Reshuffle wipes all flags.
        setFlames(new Map())
      }
    })
  }, [])

  return (
    <div className="burning-overlay" aria-hidden>
      {Array.from(flames.values()).map((f) => {
        // Flame shrinks as duration approaches 0 — visual proxy for
        // "how much longer this burns". On the final turn we hold the
        // size at 0.85 (well above the small-end of 0.55) and the
        // .is-fizzling class layers an urgent opacity flicker on top
        // so the player gets a clear "about to wink out" tell.
        const fizzling = f.remaining <= 1
        const scale = fizzling ? 0.85 : Math.min(1, 0.55 + 0.225 * f.remaining)
        return (
          <span
            key={keyOf(f)}
            className={`burning-cell${fizzling ? ' is-fizzling' : ''}`}
            style={{
              gridColumn: f.x + 1,
              gridRow: f.y + 1,
              ['--flame-scale' as string]: scale.toFixed(3),
            }}
            data-remaining={f.remaining}
            title={`Burning — ${f.remaining} turn${f.remaining === 1 ? '' : 's'} left. Matching this tile gives you Burn.`}
          >
            <span className="burning-flame">🔥</span>
          </span>
        )
      })}
      {bursts.map((b) => (
        <span
          key={`burst-${b.id}`}
          className="burning-burst"
          style={{ gridColumn: b.x + 1, gridRow: b.y + 1 }}
        >
          <span className="burst-core">🔥</span>
          <span className="burst-spark spark-1">✦</span>
          <span className="burst-spark spark-2">✦</span>
          <span className="burst-spark spark-3">✦</span>
          <span className="burst-spark spark-4">✦</span>
        </span>
      ))}
    </div>
  )
}

function initialFlamesFromStore(): Map<string, Flame> {
  const s = useGameStore.getState()
  const out = new Map<string, Flame>()
  for (let y = 0; y < s.board.cells.length; y++) {
    const row = s.board.cells[y]
    if (!row) continue
    for (let x = 0; x < row.length; x++) {
      const b = row[x]?.flags?.burning
      if (b && b > 0) out.set(`${x},${y}`, { x, y, remaining: b })
    }
  }
  return out
}

// Default duration for a freshly-placed burning flag. Read from the
// store's current board state of the *last placed* cell if available;
// otherwise fall back to 2 (matches Bleeder content). This avoids
// hardcoding the duration in two places.
function burnDurationFromStore(): number {
  const s = useGameStore.getState()
  for (let y = 0; y < s.board.cells.length; y++) {
    const row = s.board.cells[y]
    if (!row) continue
    for (let x = 0; x < row.length; x++) {
      const b = row[x]?.flags?.burning
      if (b && b > 0) return b
    }
  }
  return 2
}
