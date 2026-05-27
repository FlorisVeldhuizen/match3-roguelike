import type { Pos } from '../types'
import type { AnimatedCellPositions } from './hooks/useAnimatedCellPositions'

export type RemovedCellAnchor = { id: string; at: Pos }

/** Detach cell-anchored overlays at these board coordinates. */
export function removeAnchorsAt(
  positions: AnimatedCellPositions,
  cells: readonly Pos[],
): RemovedCellAnchor[] {
  const removed: RemovedCellAnchor[] = []
  for (const c of cells) {
    const id = positions.findIdAt(c.x, c.y)
    if (!id) continue
    positions.remove(id)
    removed.push({ id, at: c })
  }
  return removed
}

export function anchorIdsAt(positions: AnimatedCellPositions, cells: readonly Pos[]): string[] {
  const ids: string[] = []
  for (const c of cells) {
    const id = positions.findIdAt(c.x, c.y)
    if (id) ids.push(id)
  }
  return ids
}
