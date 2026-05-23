import { useEffect, useRef, useState } from 'react'
import { useGameStore } from '../../core/state/store'
import { subscribeGameEvents } from '../../core/events/emitter'
import { TRAIL_ARRIVAL_MS } from '../../timing'
import type { Pos } from '../../types'

// Animation-timed overlay. We deliberately do NOT mirror s.board.cells:
// that state commits at swap time (before the cascade animates), which
// would yank the flame off-screen before the gem itself even clears.
// Instead we drive the displayed flames off animation-timed events:
//   - tile-burn-placed:   add flames at the listed cells (Smolder's verb).
//   - tile-burn-triggered: spawn a burst at the cleared cells, then drop
//                          them from the displayed set after the burst.
//   - cell-flag-ticked / 'burning': decrement the visible countdown so
//     the number on each flame matches the game state.
// We also resync the full set from the store on fight reset (fightCounter bump).
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
  // Lazy initializer reads the store once at mount; matches the store
  // state for that first frame without firing a setState in an effect.
  const [flames, setFlames] = useState<Map<string, Flame>>(() =>
    initialFlamesFromStore(),
  )
  const [bursts, setBursts] = useState<Burst[]>([])
  // Track the current board-hover cell so flames can react like gems
  // do under the cursor. BoardScene emits board-hover on cell-cross
  // transitions so this state only churns when the player crosses a
  // cell boundary, not on every mousemove pixel.
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)
  const burstIdRef = useRef(0)

  // Resync on fight reset (new fight via reward, skip, or restart).
  useEffect(() => {
    let prevFightCounter = useGameStore.getState().fightCounter
    return useGameStore.subscribe((s) => {
      if (s.fightCounter === prevFightCounter) return
      prevFightCounter = s.fightCounter
      setFlames(initialFlamesFromStore())
      setBursts([])
    })
  }, [])

  useEffect(() => {
    return subscribeGameEvents((event) => {
      if (event.kind === 'tile-burn-placed') {
        const cells = event.cells
        const duration = event.duration
        // Delay flame appearance to the trail-arrival beat — the
        // AnimationController spawns ember particles from the enemy
        // to each cell, and the flame should "ignite" when those
        // particles land, not the instant the event fires.
        window.setTimeout(() => {
          setFlames((prev) => {
            const next = new Map(prev)
            for (const c of cells) {
              next.set(keyOf(c), { x: c.x, y: c.y, remaining: duration })
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
      } else if (event.kind === 'swap') {
        // Engine swaps cell references on a swap; the burning flag
        // travels with the cell. Mirror that in the overlay so the
        // flame slides with the gem (rather than staying glued to the
        // original cell). Invalid swaps emit `swap-reverted` after,
        // which we undo below.
        setFlames((prev) => swapFlames(prev, event.from, event.to))
      } else if (event.kind === 'swap-reverted') {
        // The swap didn't form a match — engine reverted. Swap the
        // overlay state back so the flame returns to its source.
        setFlames((prev) => swapFlames(prev, event.from, event.to))
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
      } else if (event.kind === 'board-shuffled') {
        // Reshuffle wipes all flags.
        setFlames(new Map())
      } else if (event.kind === 'board-hover') {
        setHoveredKey(event.cell ? keyOf(event.cell) : null)
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
        const k = keyOf(f)
        const hovered = hoveredKey === k
        return (
          <span
            key={k}
            className={`burning-cell${fizzling ? ' is-fizzling' : ''}${hovered ? ' is-hovered' : ''}`}
            style={{
              // Absolute %-positioning lets the flame tween smoothly
              // when its (x, y) changes (swap, gravity). Grid
              // positions can't transition.
              left: `${f.x * 12.5}%`,
              top: `${f.y * 12.5}%`,
              ['--flame-scale' as string]: scale.toFixed(3),
            }}
            data-remaining={f.remaining}
          >
            <span className="burning-flame">🔥</span>
          </span>
        )
      })}
      {bursts.map((b) => (
        <span
          key={`burst-${b.id}`}
          className="burning-burst"
          style={{
            left: `${b.x * 12.5}%`,
            top: `${b.y * 12.5}%`,
          }}
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

// Swap the flames sitting at two positions (either may be empty — in
// which case the present flame just relocates). Pure: returns a new
// Map if anything changed, otherwise the original ref.
function swapFlames(
  prev: Map<string, Flame>,
  from: Pos,
  to: Pos,
): Map<string, Flame> {
  const fromK = `${from.x},${from.y}`
  const toK = `${to.x},${to.y}`
  const fFlame = prev.get(fromK)
  const tFlame = prev.get(toK)
  if (!fFlame && !tFlame) return prev
  const next = new Map(prev)
  next.delete(fromK)
  next.delete(toK)
  if (fFlame) next.set(toK, { ...fFlame, x: to.x, y: to.y })
  if (tFlame) next.set(fromK, { ...tFlame, x: from.x, y: from.y })
  return next
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
