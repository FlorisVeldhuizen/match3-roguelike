import { useGameStore } from '../core/state/store'
import type { Pos } from '../types'

const samePos = (a: Pos, b: Pos) => a.x === b.x && a.y === b.y
const adjacent = (a: Pos, b: Pos) => {
  const dx = Math.abs(a.x - b.x)
  const dy = Math.abs(a.y - b.y)
  return (dx === 1 && dy === 0) || (dx === 0 && dy === 1)
}

export type SwapPerformer = (from: Pos, to: Pos) => Promise<void>

export type BoardInteraction = {
  click: (pos: Pos) => Promise<void>
  dragSwap: (from: Pos, to: Pos) => Promise<void>
}

export function createBoardInteraction(opts: {
  performSwap: SwapPerformer
  isAnimating: () => boolean
}): BoardInteraction {
  const click = async (pos: Pos) => {
    if (opts.isAnimating()) return
    const store = useGameStore.getState()
    if (store.fight.phase === 'victory') return
    const selected = store.board.selected
    if (!selected) {
      store.selectCell(pos)
      return
    }
    if (samePos(selected, pos)) {
      store.selectCell(null)
      return
    }
    if (adjacent(selected, pos)) {
      store.selectCell(null)
      await opts.performSwap(selected, pos)
      return
    }
    store.selectCell(pos)
  }

  const dragSwap = async (from: Pos, to: Pos) => {
    if (opts.isAnimating()) return
    if (!adjacent(from, to)) return
    const store = useGameStore.getState()
    if (store.fight.phase === 'victory') return
    store.selectCell(null)
    await opts.performSwap(from, to)
  }

  return { click, dragSwap }
}
