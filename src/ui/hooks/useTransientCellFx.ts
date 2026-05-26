import { useCallback, useRef, useState } from 'react'

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
