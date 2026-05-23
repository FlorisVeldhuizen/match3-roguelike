import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { subscribeGameEvents } from '../../core/events/emitter'
import {
  SWAP_MS,
  fallDurationMs,
  SWAP_BEZIER,
  FALL_BEZIER,
} from '../../timing'

// Tracks the live (animated) position of cell-anchored decorations —
// burning flames today, but the API stays decoration-agnostic so
// petrify / hex / curse / pending-shove plug in identically. The hook
// owns:
//   1. logical (x, y) per decoration id
//   2. an inline `transition` string per decoration that mirrors the
//      gem-sprite tween for whatever motion event last fired (swap or
//      gravity), so CSS interpolates left/top in lockstep with the gem
//      underneath instead of using a static fallback duration.
//
// The hook subscribes to swap / swap-reverted / gems-fell once and
// re-keys entries internally. Consumers manage their own metadata-
// by-id (e.g. burn remaining) and just render at the position
// returned here.

export type CellTransition = {
  durationMs: number
  bezier: string
}

export type AnimatedCellPosition = {
  x: number
  y: number
  // null = snap (decoration just placed or fight reset); otherwise the
  // CSS transition descriptor that matches the in-flight gem motion.
  transition: CellTransition | null
}

export type AnimatedCellPositions = {
  positions: ReadonlyMap<string, AnimatedCellPosition>
  // Place a decoration at a logical cell. Snaps with no transition — the
  // caller is responsible for any "ignite" stagger before calling this.
  set(id: string, x: number, y: number): void
  remove(id: string): void
  clear(): void
  // Returns the id whose logical position is currently (x, y), or null.
  // Used by overlays that receive events keyed by position (e.g. burn's
  // tile-burn-triggered, cell-flag-ticked) and need to look up which of
  // their decorations is affected.
  findIdAt(x: number, y: number): string | null
}

export function useAnimatedCellPositions(): AnimatedCellPositions {
  const entriesRef = useRef<Map<string, AnimatedCellPosition>>(new Map())
  const [snapshot, setSnapshot] = useState<
    ReadonlyMap<string, AnimatedCellPosition>
  >(new Map())

  const publish = useCallback(() => {
    const next = new Map<string, AnimatedCellPosition>()
    for (const [id, e] of entriesRef.current) {
      next.set(id, { x: e.x, y: e.y, transition: e.transition })
    }
    setSnapshot(next)
  }, [])

  const set = useCallback(
    (id: string, x: number, y: number) => {
      entriesRef.current.set(id, { x, y, transition: null })
      publish()
    },
    [publish],
  )

  const remove = useCallback(
    (id: string) => {
      if (entriesRef.current.delete(id)) publish()
    },
    [publish],
  )

  const clear = useCallback(() => {
    if (entriesRef.current.size === 0) return
    entriesRef.current.clear()
    publish()
  }, [publish])

  const findIdAt = useCallback((x: number, y: number): string | null => {
    for (const [id, e] of entriesRef.current) {
      if (e.x === x && e.y === y) return id
    }
    return null
  }, [])

  useEffect(() => {
    return subscribeGameEvents((event) => {
      if (event.kind === 'swap' || event.kind === 'swap-reverted') {
        // Snapshot both endpoints first; the entry currently at `from`
        // and the entry currently at `to` swap logical positions.
        // Resolving both before mutating prevents the first update from
        // shadowing the second.
        const aId = findIdAt(event.from.x, event.from.y)
        const bId = findIdAt(event.to.x, event.to.y)
        if (!aId && !bId) return
        const transition: CellTransition = {
          durationMs: SWAP_MS,
          bezier: SWAP_BEZIER,
        }
        if (aId) {
          entriesRef.current.set(aId, {
            x: event.to.x,
            y: event.to.y,
            transition,
          })
        }
        if (bId) {
          entriesRef.current.set(bId, {
            x: event.from.x,
            y: event.from.y,
            transition,
          })
        }
        publish()
      } else if (event.kind === 'gems-fell') {
        // Gravity step: each movement is disjoint (gravity never lands
        // a gem in another moving gem's start row within one step), so
        // sequential updates are safe.
        let any = false
        for (const m of event.movements) {
          const id = findIdAt(m.from.x, m.from.y)
          if (!id) continue
          const distance = Math.abs(m.to.y - m.from.y)
          entriesRef.current.set(id, {
            x: m.to.x,
            y: m.to.y,
            transition: {
              durationMs: fallDurationMs(distance),
              bezier: FALL_BEZIER,
            },
          })
          any = true
        }
        if (any) publish()
      }
    })
  }, [findIdAt, publish])

  // Memoize the returned API. set/remove/clear/findIdAt are stable via
  // useCallback; the only changing dep is `snapshot`. Without this, the
  // wrapper object would be fresh every render and any consumer with
  // `[positions]` in a useEffect dep would resubscribe on every render.
  return useMemo(
    () => ({ positions: snapshot, set, remove, clear, findIdAt }),
    [snapshot, set, remove, clear, findIdAt],
  )
}
