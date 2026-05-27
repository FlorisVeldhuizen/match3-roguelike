import { describe, expect, it } from 'vitest'
import { anchorIdsAt, removeAnchorsAt } from './cellAnchors'
import type { AnimatedCellPositions } from './hooks/useAnimatedCellPositions'

function mockPositions(
  entries: Array<{ id: string; x: number; y: number }>,
): AnimatedCellPositions {
  const map = new Map(
    entries.map((e) => [e.id, { x: e.x, y: e.y, transition: null }]),
  )
  const store = new Map(entries.map((e) => [e.id, { x: e.x, y: e.y }]))
  return {
    positions: map,
    set(id: string, x: number, y: number) {
      store.set(id, { x, y })
      map.set(id, { x, y, transition: null })
    },
    remove(id: string) {
      store.delete(id)
      map.delete(id)
    },
    clear() {
      store.clear()
      map.clear()
    },
    findIdAt(x: number, y: number) {
      for (const [id, e] of store) {
        if (e.x === x && e.y === y) return id
      }
      return null
    },
  }
}

describe('cellAnchors', () => {
  it('removeAnchorsAt clears matching anchors', () => {
    const positions = mockPositions([
      { id: 'a', x: 1, y: 2 },
      { id: 'b', x: 3, y: 4 },
    ])
    const removed = removeAnchorsAt(positions, [{ x: 1, y: 2 }])
    expect(removed).toEqual([{ id: 'a', at: { x: 1, y: 2 } }])
    expect(positions.findIdAt(1, 2)).toBeNull()
    expect(positions.findIdAt(3, 4)).toBe('b')
  })

  it('anchorIdsAt lists ids without removing', () => {
    const positions = mockPositions([{ id: 'flame-1', x: 0, y: 0 }])
    expect(anchorIdsAt(positions, [{ x: 0, y: 0 }])).toEqual(['flame-1'])
    expect(positions.findIdAt(0, 0)).toBe('flame-1')
  })
})
