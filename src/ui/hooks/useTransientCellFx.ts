import { useCallback, useRef, useState } from 'react'

// Registry of short-lived, cell-anchored visual effects (bursts, fizzles,
// shatters, …). Each item carries a unique id, a logical cell, and is
// auto-pruned `durationMs` after spawn so the consumer doesn't have to
// hand-manage setTimeout cleanup.
//
// Generic over a per-item meta payload so a consumer can, e.g., remember
// what color spark to render. When no meta is needed, leave the param
// unset (defaults to undefined) and just read x/y.
//
// Pattern matches the burning-overlay's bursts + fizzles registries and
// is intended as the foundation for any future cell-anchored FX.

export type TransientCellFx<TMeta = undefined> = {
  id: number
  x: number
  y: number
  meta: TMeta
}

export type SpawnCell<TMeta = undefined> = TMeta extends undefined
  ? { x: number; y: number; meta?: undefined }
  : { x: number; y: number; meta: TMeta }

export type UseTransientCellFx<TMeta = undefined> = {
  items: ReadonlyArray<TransientCellFx<TMeta>>
  spawn(cells: ReadonlyArray<SpawnCell<TMeta>>): void
  clear(): void
}

export function useTransientCellFx<TMeta = undefined>(
  durationMs: number,
): UseTransientCellFx<TMeta> {
  const [items, setItems] = useState<TransientCellFx<TMeta>[]>([])
  const idRef = useRef(0)

  const spawn = useCallback(
    (cells: ReadonlyArray<SpawnCell<TMeta>>) => {
      if (cells.length === 0) return
      const fresh: TransientCellFx<TMeta>[] = cells.map((c) => ({
        id: ++idRef.current,
        x: c.x,
        y: c.y,
        meta: c.meta as TMeta,
      }))
      setItems((prev) => [...prev, ...fresh])
      const freshIds = new Set(fresh.map((f) => f.id))
      window.setTimeout(() => {
        setItems((prev) => prev.filter((it) => !freshIds.has(it.id)))
      }, durationMs)
    },
    [durationMs],
  )

  const clear = useCallback(() => {
    setItems((prev) => (prev.length === 0 ? prev : []))
  }, [])

  return { items, spawn, clear }
}
