import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useGameStore } from '../../core/state/store'
import { subscribeGameEvents } from '../../core/events/emitter'
import { TRAIL_ARRIVAL_MS } from '../../timing'
import { useAnimatedCellPositions } from '../hooks/useAnimatedCellPositions'
import { useTransientCellFx } from '../hooks/useTransientCellFx'
import { useBoardWipe } from '../hooks/useBoardWipe'
import { useFightReset } from '../hooks/useFightReset'
import { useHoveredCellKey } from '../hooks/useHoveredCellKey'
import { CellAnchor } from './CellAnchor'
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
// Fight resets reseed from the store; board-wipe events (shuffle/sweep)
// just clear everything.
//
// Position tracking, transient FX, hover, and board-wipe lifecycle all
// live in shared primitives (useAnimatedCellPositions, useTransientCellFx,
// useHoveredCellKey, useBoardWipe, useFightReset) so future cell-anchored
// overlays (petrify, freeze, hex, …) plug into the same foundation.

type FlameMeta = { remaining: number }

const BURST_MS = 720
// Soft smoke puff for the "burn expired" beat (countdown ran out without
// being triggered). Longer than BURST_MS so the player has time to
// register a happy event — at 650ms it was too quick to catch, the
// puff was gone before the eye landed on it. Softer in shape than
// BURST_MS so it still reads as "passed without firing" rather than
// "exploded" despite being longer.
const FIZZLE_MS = 1200

const keyOf = (p: Pos) => `${p.x},${p.y}`

export function BurningOverlay() {
  const positions = useAnimatedCellPositions()
  const [meta, setMeta] = useState<Map<string, FlameMeta>>(new Map())
  // Mirror of meta for read-only access inside event handlers without
  // forcing a resubscribe when meta changes. The cell-flag-ticked
  // handler needs the live remaining count to decide whether a flame
  // expires this tick.
  const metaRef = useRef(meta)
  useEffect(() => {
    metaRef.current = meta
  }, [meta])
  const bursts = useTransientCellFx(BURST_MS)
  const fizzles = useTransientCellFx(FIZZLE_MS)
  const hoveredKey = useHoveredCellKey()
  const flameIdRef = useRef(0)

  // Initial seed from store on mount. useLayoutEffect so positions +
  // meta land before the first paint (no empty-flame flash if a fight
  // begins with already-burning tiles, e.g. on a save reload).
  useLayoutEffect(() => {
    setMeta(seedMetaFromStore(positions.set, flameIdRef))
    // Intentionally one-shot; fight resets handle their own reseed below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const wipeAll = useCallback(() => {
    positions.clear()
    setMeta(new Map())
    bursts.clear()
    fizzles.clear()
  }, [positions, bursts, fizzles])

  useFightReset(
    useCallback(() => {
      wipeAll()
      setMeta(seedMetaFromStore(positions.set, flameIdRef))
    }, [wipeAll, positions]),
  )

  useBoardWipe(wipeAll)

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
        bursts.spawn(event.cells.map((c) => ({ x: c.x, y: c.y })))
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
          fizzles.spawn(expired.map((p) => ({ x: p.x, y: p.y })))
        }
        setMeta((prev) => {
          const next = new Map(prev)
          for (const t of ticks) {
            if (t.remaining === 'expire') next.delete(t.id)
            else next.set(t.id, { remaining: t.remaining })
          }
          return next
        })
      }
    })
  }, [positions, bursts, fizzles])

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
        return (
          <CellAnchor
            key={id}
            x={p.x}
            y={p.y}
            transition={p.transition}
            className={`burning-cell${fizzling ? ' is-fizzling' : ''}${hovered ? ' is-hovered' : ''}`}
            style={{ ['--flame-scale' as string]: scale.toFixed(3) }}
            data-remaining={m.remaining}
          >
            <span className="burning-flame">
              <FlameSvg />
            </span>
          </CellAnchor>
        )
      })}
      {bursts.items.map((b) => (
        <CellAnchor key={`burst-${b.id}`} x={b.x} y={b.y} className="burning-burst">
          <span className="burst-core">
            <FlameSvg />
          </span>
          <span className="burst-spark spark-1">
            <SparkSvg />
          </span>
          <span className="burst-spark spark-2">
            <SparkSvg />
          </span>
          <span className="burst-spark spark-3">
            <SparkSvg />
          </span>
          <span className="burst-spark spark-4">
            <SparkSvg />
          </span>
        </CellAnchor>
      ))}
      {fizzles.items.map((f) => (
        <CellAnchor key={`fizzle-${f.id}`} x={f.x} y={f.y} className="burning-fizzle">
          <span className="fizzle-smoke">
            <SmokeSvg />
          </span>
        </CellAnchor>
      ))}
    </div>
  )
}

// Palette-matched SVG flame. Replaces the 🔥 emoji used previously —
// the emoji fidelity didn't sit alongside the Pixi particle palette
// (FLAME_PALETTE / FLAME_CORE_HEX) used everywhere else for fire FX.
// Hex stops match those particle colors: deep red → bright ember →
// hot orange → amber → molten core. A separate inner-core gradient
// makes the base of the flame glow brighter, mimicking real flame
// physics (hottest at the bottom near the fuel). preserveAspectRatio
// 'xMidYMax' anchors the flame's foot to the middle-bottom of its box
// so transform:scale keeps the flame "standing on the gem" rather
// than centering and floating mid-cell.
function FlameSvg() {
  return (
    <svg
      viewBox="0 0 24 32"
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMax meet"
      aria-hidden
    >
      <defs>
        <radialGradient id="flame-body" cx="50%" cy="78%" r="65%">
          <stop offset="0%" stopColor="#ffe39a" />
          <stop offset="32%" stopColor="#ffc15c" />
          <stop offset="62%" stopColor="#ff9034" />
          <stop offset="92%" stopColor="#ee5e57" />
          <stop offset="100%" stopColor="#c4423c" />
        </radialGradient>
        <radialGradient id="flame-core" cx="50%" cy="84%" r="40%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="50%" stopColor="#ffe39a" stopOpacity="0.75" />
          <stop offset="100%" stopColor="#ffc15c" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* Teardrop flame body — pointed tip with a curled-back top to
          give it motion, broad rounded base for the "sitting on the
          gem" silhouette. */}
      <path
        d="M12 1.5
           C 10 7, 6.5 10, 5 16
           C 3.5 22, 6 30, 12 30.5
           C 18 30, 20.5 22, 19 16
           C 17.5 10, 14.5 8, 13.5 4
           C 13.2 2.6, 12.6 1.7, 12 1.5 Z"
        fill="url(#flame-body)"
      />
      {/* Inner core: brighter bottom glow. Eccentric ellipse rather
          than circle so the molten heart reads as fire shape. */}
      <ellipse cx="12" cy="22" rx="4.5" ry="6" fill="url(#flame-core)" />
    </svg>
  )
}

// Diamond-shaped ember spark — replaces the ✦ unicode char so the
// sparks render consistently across platforms (some fonts substitute
// ✦ with a less-fiery glyph) and pick up our palette directly.
function SparkSvg() {
  return (
    <svg
      viewBox="0 0 12 12"
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      <defs>
        <radialGradient id="spark-body" cx="50%" cy="50%" r="55%">
          <stop offset="0%" stopColor="#ffe39a" />
          <stop offset="55%" stopColor="#ffc15c" />
          <stop offset="100%" stopColor="#ff9034" />
        </radialGradient>
      </defs>
      {/* Four-point star (longer vertical axis). */}
      <path
        d="M6 0 L7.2 4.8 L12 6 L7.2 7.2 L6 12 L4.8 7.2 L0 6 L4.8 4.8 Z"
        fill="url(#spark-body)"
      />
    </svg>
  )
}

// Smoke wisp — replaces the 💨 emoji used for the fizzle puff. The
// emoji was horizontal (wind-style) and got rotated -90° via CSS to
// point up; here it's natively vertical so the CSS keyframe doesn't
// need the rotation workaround. Cool grey-blue to read as "fire is
// out" rather than warm ember tones.
function SmokeSvg() {
  return (
    <svg
      viewBox="0 0 24 32"
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      <defs>
        <radialGradient id="smoke-body" cx="50%" cy="55%" r="60%">
          <stop offset="0%" stopColor="#dad6ce" stopOpacity="0.85" />
          <stop offset="60%" stopColor="#a89f93" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#776e63" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* Three soft puffs stacked into a wisp — bottom widest, top
          narrowest, slight S-curve. */}
      <ellipse cx="12" cy="22" rx="8" ry="6" fill="url(#smoke-body)" />
      <ellipse cx="13" cy="14" rx="6" ry="5" fill="url(#smoke-body)" />
      <ellipse cx="11" cy="7" rx="4" ry="3.5" fill="url(#smoke-body)" />
    </svg>
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
