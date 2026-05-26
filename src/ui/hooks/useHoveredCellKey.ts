import { useEffect, useState } from 'react'
import { subscribeGameEvents } from '../../core/events/emitter'
import type { Pos } from '../../types'

const keyOf = (p: Pos) => `${p.x},${p.y}`

export function useHoveredCellKey(): string | null {
  const [key, setKey] = useState<string | null>(null)
  useEffect(() => {
    return subscribeGameEvents((event) => {
      if (event.kind === 'board-hover') {
        setKey(event.cell ? keyOf(event.cell) : null)
      }
    })
  }, [])
  return key
}
