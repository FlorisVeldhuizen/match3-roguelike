import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useGameStore } from '../../core/state/store'
import { subscribeGameEvents } from '../../core/events/emitter'
import { TRAIL_ARRIVAL_MS } from '../../timing'
import { useAnimatedCellPositions } from '../hooks/useAnimatedCellPositions'
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
// Position tracking + per-event transition timing live in
// useAnimatedCellPositions so swap/gravity slide the flame in lockstep
// with the gem sprite underneath. This component only manages
// burn-specific metadata (remaining duration, bursts, hover).
//
// The overlay sits INSIDE .board-mount with a small percentage inset
// (BOARD_PADDING / LOGICAL_SIZE = 8/528 ≈ 1.515%) so the 8×8 grid lines
// up with the gem grid inside the Pixi canvas — not with the canvas
// edge.

type FlameMeta = { remaining: number }
type Burst = { id: number; x: number; y: number }
type Fizzle = { id: number; x: number; y: number }

const BURST_MS = 720
// Soft smoke puff for the "burn expired" beat (countdown ran out without
// being triggered). Shorter and softer than BURST_MS so it reads as
// "passed without firing" rather than "exploded".
const FIZZLE_MS = 650

const keyOf = (p: Pos) => `${p.x},${p.y}`

export function BurningOverlay() {
  const positions = useAnimatedCellPositions()
  const [meta, setMeta] = useState<Map<string, FlameMeta>>(new Map())
  // Mirror of meta for read-only access inside event handlers without
  // forcing a resubscribe when meta changes. The cell-flag-ticked
  // handler needs the live remaining count to decide whether a flame
  // expires this tick. Synced via effect (writing the ref during
  // render is disallowed by the project's lint rules).
  const metaRef = useRef(meta)
  useEffect(() => {
    metaRef.current = meta
  }, [meta])
  const [bursts, setBursts] = useState<Burst[]>([])
  const [fizzles, setFizzles] = useState<Fizzle[]>([])
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)
  const burstIdRef = useRef(0)
  const fizzleIdRef = useRef(0)
  const flameIdRef = useRef(0)

  // Initial seed from store on mount. useLayoutEffect so positions +
  // meta land before the first paint (no empty-flame flash if a fight
  // begins with already-burning tiles, e.g. on a save reload).
  useLayoutEffect(() => {
    setMeta(seedMetaFromStore(positions.set, flameIdRef))
    // Intentionally one-shot; fight resets handle their own reseed below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Resync on fight reset (new fight via reward, skip, or restart).
  useEffect(() => {
    let prevFightCounter = useGameStore.getState().fightCounter
    return useGameStore.subscribe((s) => {
      if (s.fightCounter === prevFightCounter) return
      prevFightCounter = s.fightCounter
      positions.clear()
      setMeta(seedMetaFromStore(positions.set, flameIdRef))
      setBursts([])
      setFizzles([])
    })
  }, [positions])

  useEffect(() => {
    return subscribeGameEvents((event) => {
      if (event.kind === 'tile-burn-placed') {
        const cells = event.cells
        const duration = event.duration
        // Delay flame appearance to the trail-arrival beat — the
        // AnimationController spawns ember particles from the enemy
        // to each cell, and the flame should "ignite" when those
        // particles land, not the instant the event fires.
        //
        // Note: positions.set / flameIdRef mutations happen OUTSIDE the
        // setMeta updater. React Strict Mode invokes state updaters
        // twice in dev; if we did the registry work inside the updater,
        // we'd allocate two ids and leak a ghost into the positions map.
        //
        // The fightCounter guard prevents a stale timeout from leaking
        // flames into a fresh fight if the fight ends within 700ms of
        // the placement (e.g. killing-blow swap while ember trails are
        // still in flight).
        const scheduledFight = useGameStore.getState().fightCounter
        window.setTimeout(() => {
          if (useGameStore.getState().fightCounter !== scheduledFight) return
          const placed: { id: string; remaining: number }[] = []
          for (const c of cells) {
            const id = `flame-${++flameIdRef.current}`
            positions.set(id, c.x, c.y)
            placed.push({ id, remaining: duration })
          }
          if (placed.length === 0) return
          setMeta((prev) => {
            const next = new Map(prev)
            for (const p of placed) next.set(p.id, { remaining: p.remaining })
            return next
          })
        }, TRAIL_ARRIVAL_MS)
      } else if (event.kind === 'tile-burn-triggered') {
        // Spawn a burst at each cell, then strip those flames so they
        // resolve visually rather than vanishing on store commit.
        // tile-burn-triggered fires before gems-fell within the cascade
        // step, so the cells here match the flames' current logical
        // positions.
        const newBursts: Burst[] = event.cells.map((c) => ({
          id: ++burstIdRef.current,
          x: c.x,
          y: c.y,
        }))
        setBursts((prev) => [...prev, ...newBursts])
        const removedIds: string[] = []
        for (const c of event.cells) {
          const id = positions.findIdAt(c.x, c.y)
          if (!id) continue
          positions.remove(id)
          removedIds.push(id)
        }
        if (removedIds.length > 0) {
          setMeta((prev) => {
            const next = new Map(prev)
            for (const id of removedIds) next.delete(id)
            return next
          })
        }
        const ids = new Set(newBursts.map((b) => b.id))
        window.setTimeout(() => {
          setBursts((prev) => prev.filter((b) => !ids.has(b.id)))
        }, BURST_MS)
      } else if (event.kind === 'cell-flag-ticked' && event.flag === 'burning') {
        // End-of-player-phase tick reduces remaining duration by 1.
        // Resolve ids and decide expirations up-front so the setMeta
        // updater stays pure (Strict Mode double-invokes updaters).
        type Tick = { id: string; pos: Pos; remaining: number | 'expire' }
        const ticks: Tick[] = []
        const m = metaRef.current
        for (const p of event.positions) {
          const id = positions.findIdAt(p.x, p.y)
          if (!id) continue
          const cur = m.get(id)
          if (!cur) continue
          const r = cur.remaining - 1
          ticks.push({ id, pos: p, remaining: r <= 0 ? 'expire' : r })
        }
        if (ticks.length === 0) return
        const expired: Pos[] = []
        for (const t of ticks) {
          if (t.remaining === 'expire') {
            positions.remove(t.id)
            expired.push(t.pos)
          }
        }
        if (expired.length > 0) {
          // Smoke puff at the cell the flame just vacated. Position is
          // captured from the event (pre-expiry logical cell), which is
          // where the player last saw the flame.
          const newFizzles: Fizzle[] = expired.map((p) => ({
            id: ++fizzleIdRef.current,
            x: p.x,
            y: p.y,
          }))
          setFizzles((prev) => [...prev, ...newFizzles])
          const ids = new Set(newFizzles.map((f) => f.id))
          window.setTimeout(() => {
            setFizzles((prev) => prev.filter((f) => !ids.has(f.id)))
          }, FIZZLE_MS)
        }
        setMeta((prev) => {
          const next = new Map(prev)
          for (const t of ticks) {
            if (t.remaining === 'expire') next.delete(t.id)
            else next.set(t.id, { remaining: t.remaining })
          }
          return next
        })
      } else if (event.kind === 'board-shuffled') {
        // Reshuffle wipes all flags. Don't fizzle — the flames don't
        // "expire", they're erased along with the board state.
        positions.clear()
        setMeta(new Map())
      } else if (event.kind === 'board-hover') {
        setHoveredKey(event.cell ? keyOf(event.cell) : null)
      }
    })
  }, [positions])

  return (
    <div className="burning-overlay" aria-hidden>
      {Array.from(positions.positions.entries()).map(([id, p]) => {
        const m = meta.get(id)
        if (!m) return null
        // Flame shrinks as duration approaches 0 — visual proxy for
        // "how much longer this burns". On the final turn we hold the
        // size at 0.85 (well above the small-end of 0.55) and the
        // .is-fizzling class layers an urgent opacity flicker on top
        // so the player gets a clear "about to wink out" tell.
        const fizzling = m.remaining <= 1
        const scale = fizzling ? 0.85 : Math.min(1, 0.55 + 0.225 * m.remaining)
        const hovered = hoveredKey === keyOf({ x: p.x, y: p.y })
        const transitionStyle = p.transition
          ? `left ${p.transition.durationMs}ms ${p.transition.bezier}, top ${p.transition.durationMs}ms ${p.transition.bezier}`
          : 'none'
        return (
          <span
            key={id}
            className={`burning-cell${fizzling ? ' is-fizzling' : ''}${hovered ? ' is-hovered' : ''}`}
            style={{
              left: `${p.x * 12.5}%`,
              top: `${p.y * 12.5}%`,
              transition: transitionStyle,
              ['--flame-scale' as string]: scale.toFixed(3),
            }}
            data-remaining={m.remaining}
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
      {fizzles.map((f) => (
        <span
          key={`fizzle-${f.id}`}
          className="burning-fizzle"
          style={{
            left: `${f.x * 12.5}%`,
            top: `${f.y * 12.5}%`,
          }}
        >
          <span className="fizzle-smoke">💨</span>
        </span>
      ))}
    </div>
  )
}

function seedMetaFromStore(
  setPosition: (id: string, x: number, y: number) => void,
  flameIdRef: { current: number },
): Map<string, FlameMeta> {
  const s = useGameStore.getState()
  const out = new Map<string, FlameMeta>()
  for (let y = 0; y < s.board.cells.length; y++) {
    const row = s.board.cells[y]
    if (!row) continue
    for (let x = 0; x < row.length; x++) {
      const b = row[x]?.flags?.burning
      if (b && b > 0) {
        const id = `flame-${++flameIdRef.current}`
        setPosition(id, x, y)
        out.set(id, { remaining: b })
      }
    }
  }
  return out
}
