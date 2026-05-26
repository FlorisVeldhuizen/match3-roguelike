import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { useGameStore } from '../../core/state/store'
import { subscribeGameEvents } from '../../core/events/emitter'
import { useFightReset } from '../hooks/useFightReset'
import { CellAnchor } from './CellAnchor'

// Lockout visualization for Defender's petrify-row verb. Event-driven
// like the other board overlays — pending → active → weakening →
// released transitions all land on the animator's playback timeline,
// not at synchronous store commit, so future polish (release pop,
// lockdown thump, etc.) can hand off cleanly without a "blink of
// normal" frame in between.
//
// Lifecycle:
//   - petrify-placed:     telegraph arrives → add the row to `pending`
//                         (warm amber warning treatment).
//   - petrify-fired:      lockout resolves → move the row from
//                         `pending` to `active` with full duration.
//   - petrify-row-ticked: decrement an active row's remaining count;
//                         transition to weakening at remaining=1; drop
//                         the row at remaining=0 (released).
//   - fight reset:        clear local state + reseed from store
//                         (handles the post-save / hard-resync case).

type Active = { row: number; remaining: number }

const DUST_PER_CELL = 2

export function PetrifyOverlay() {
  const [pending, setPending] = useState<Set<number>>(new Set())
  const [active, setActive] = useState<Map<number, Active>>(new Map())
  const w = useGameStore(
    (s) => s.board.cells[0]?.length ?? 0,
  )

  // Seed from store on mount and on fight reset. Pending is derived
  // from any living enemy with a petrify-row intent telegraphed;
  // active is the canonical petrifiedRows map.
  const seedFromStore = useCallback(() => {
    const s = useGameStore.getState()
    const nextPending = new Set<number>()
    for (const e of s.fight.enemies) {
      if (e.hp <= 0) continue
      if (e.currentIntent.kind === 'petrify-row') {
        // Suppress pending if the row is already active — the heavier
        // active visual takes precedence (matches the runtime gate
        // below for petrify-placed).
        if ((s.board.petrifiedRows[e.currentIntent.row] ?? 0) === 0) {
          nextPending.add(e.currentIntent.row)
        }
      }
    }
    const nextActive = new Map<number, Active>()
    for (const [rowStr, remaining] of Object.entries(s.board.petrifiedRows)) {
      if (remaining > 0) {
        nextActive.set(Number(rowStr), { row: Number(rowStr), remaining })
      }
    }
    setPending(nextPending)
    setActive(nextActive)
  }, [])

  useLayoutEffect(() => {
    seedFromStore()
  }, [seedFromStore])

  useFightReset(
    useCallback(() => {
      setPending(new Set())
      setActive(new Map())
      seedFromStore()
    }, [seedFromStore]),
  )

  useEffect(() => {
    return subscribeGameEvents((event) => {
      if (event.kind === 'petrify-placed') {
        setPending((prev) => {
          if (prev.has(event.row)) return prev
          const next = new Set(prev)
          next.add(event.row)
          return next
        })
      } else if (event.kind === 'petrify-fired') {
        // Telegraph → resolved: move the row out of pending and into
        // active. Both updates apply in the same render so the visual
        // transitions cleanly from amber warning to grey lockout.
        setPending((prev) => {
          if (!prev.has(event.row)) return prev
          const next = new Set(prev)
          next.delete(event.row)
          return next
        })
        setActive((prev) => {
          const next = new Map(prev)
          next.set(event.row, { row: event.row, remaining: event.duration })
          return next
        })
      } else if (event.kind === 'petrify-row-ticked') {
        if (event.remaining > 0) {
          setActive((prev) => {
            const cur = prev.get(event.row)
            if (!cur || cur.remaining === event.remaining) return prev
            const next = new Map(prev)
            next.set(event.row, { row: event.row, remaining: event.remaining })
            return next
          })
        } else {
          // Released: drop the row.
          setActive((prev) => {
            if (!prev.has(event.row)) return prev
            const next = new Map(prev)
            next.delete(event.row)
            return next
          })
        }
      }
    })
  }, [])

  // Build per-cell render lists. Pending rows render first (lower
  // z-index in the overlay stack); active rows on top.
  const pendingCells: { x: number; y: number; key: string }[] = []
  for (const y of pending) {
    for (let x = 0; x < w; x++) {
      pendingCells.push({ x, y, key: `petrify-pending-${y}-${x}` })
    }
  }
  const activeCells: {
    x: number
    y: number
    key: string
    isWeakening: boolean
  }[] = []
  for (const [y, a] of active) {
    const isWeakening = a.remaining === 1
    for (let x = 0; x < w; x++) {
      activeCells.push({ x, y, key: `petrify-${y}-${x}`, isWeakening })
    }
  }

  return (
    <div className="petrify-overlay" aria-hidden>
      {pendingCells.map(({ x, y, key }) => (
        <CellAnchor key={key} x={x} y={y} className="petrify-cell is-pending" />
      ))}
      {activeCells.map(({ x, y, key, isWeakening }) =>
        isWeakening ? (
          <WeakeningCell key={key} x={x} y={y} />
        ) : (
          <CellAnchor key={key} x={x} y={y} className="petrify-cell" />
        ),
      )}
    </div>
  )
}

// Weakening cell wrapper. Owns a stable-per-mount random tremble
// config so each cell in a weakening row shakes at its own speed and
// phase offset rather than every cell ticking in lockstep. Also hosts
// the dust specks — keeping the random config + dust together in one
// component avoids re-rolling on parent re-renders.
type TrembleConfig = {
  duration: number // seconds (0.5–0.85 — slight per-cell speed variance)
  delay: number // seconds (0 to -0.7 — phase offset across cells)
}

function randomTrembleConfig(): TrembleConfig {
  return {
    duration: 0.5 + Math.random() * 0.35,
    delay: -Math.random() * 0.7,
  }
}

function WeakeningCell({ x, y }: { x: number; y: number }) {
  const configRef = useRef<TrembleConfig | null>(null)
  if (configRef.current === null) {
    configRef.current = randomTrembleConfig()
  }
  const cfg = configRef.current
  return (
    <>
      {/* Wash layer — the shaking stone. Renders the ::before grey
          wash + the pulse + the tremble. No children, so nothing
          inherits the transform. */}
      <CellAnchor
        x={x}
        y={y}
        className="petrify-cell is-weakening"
        style={
          {
            '--tremble-dur': `${cfg.duration.toFixed(2)}s`,
            '--tremble-delay': `${cfg.delay.toFixed(2)}s`,
          } as CSSProperties
        }
      />
      {/* Dust layer — sibling at the same logical cell position, but
          OUTSIDE the shaking wrapper. Once dust falls off the stone,
          it's no longer "part of" the stone — it should fall freely
          under gravity, not jitter along with the cell. Splitting the
          DOM is the simplest way to break the transform inheritance. */}
      <CellAnchor x={x} y={y} className="petrify-dust-layer">
        {Array.from({ length: DUST_PER_CELL }).map((_, i) => (
          <PetrifyDust key={i} />
        ))}
      </CellAnchor>
    </>
  )
}

// Individual dust speck. Picks a random position + timing on first
// mount (preserved across re-renders via a ref) and re-rolls position
// at each animation loop end so the same gem doesn't keep shedding
// from the exact same three spots forever. Mirrors BlessedSpark's
// approach to ambient particle variety.
type DustConfig = {
  left: number // 5-95 (percent within cell)
  delay: number // seconds (negative for stagger; 0 to -1.8)
  duration: number // seconds (1.3 to 2.2 — slight variation per particle)
}

function randomDustLeft(): number {
  return 5 + Math.random() * 90
}

function randomDustConfig(): DustConfig {
  return {
    left: randomDustLeft(),
    delay: -Math.random() * 1.8,
    duration: 1.3 + Math.random() * 0.9,
  }
}

function PetrifyDust() {
  const ref = useRef<HTMLSpanElement>(null)
  // First-mount config kept stable across re-renders via the ref. Each
  // particle picks its own random position / delay / duration so the
  // 3-per-cell × N-cell crumble doesn't visually tile.
  const configRef = useRef<DustConfig | null>(null)
  if (configRef.current === null) {
    configRef.current = randomDustConfig()
  }
  const initial = configRef.current

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Re-roll the horizontal position each loop, at the keyframe's 0%
    // opacity:0 moment, so the particle never visibly teleports.
    const onIter = () => {
      el.style.left = `${randomDustLeft().toFixed(2)}%`
    }
    el.addEventListener('animationiteration', onIter)
    return () => el.removeEventListener('animationiteration', onIter)
  }, [])

  return (
    <span
      ref={ref}
      className="petrify-dust"
      style={{
        left: `${initial.left.toFixed(2)}%`,
        animationDelay: `${initial.delay.toFixed(2)}s`,
        animationDuration: `${initial.duration.toFixed(2)}s`,
      }}
    />
  )
}
