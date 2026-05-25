import { useEffect, useState } from 'react'
import { subscribeGameEvents } from '../../core/events/emitter'
import type { Pos } from '../../types'

// Returns the currently-hovered board cell as a stable string key
// ("x,y"), or null when the pointer is off the board. Drives "is-hovered"
// presentation on cell-anchored overlays.
//
// The string-key form is what overlays actually need for fast equality
// inside a render loop (`hoveredKey === keyOf({ x, y })`); the raw Pos is
// hidden so the hook can stay an internal-detail-free dependency.

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
