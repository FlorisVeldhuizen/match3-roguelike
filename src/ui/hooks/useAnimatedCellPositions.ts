import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { subscribeGameEvents } from '../../core/events/emitter'
import {
  SWAP_MS,
  fallDurationMs,
  SWAP_BEZIER,
  FALL_BEZIER,
} from '../../timing'

export type CellTransition = {
  durationMs: number
  bezier: string
}

export type AnimatedCellPosition = {
  x: number
  y: number
  transition: CellTransition | null
}

export type AnimatedCellPositions = {
  positions: ReadonlyMap<string, AnimatedCellPosition>
  set(id: string, x: number, y: number): void
  remove(id: string): void
  clear(): void
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

  return useMemo(
    () => ({ positions: snapshot, set, remove, clear, findIdAt }),
    [snapshot, set, remove, clear, findIdAt],
  )
}
