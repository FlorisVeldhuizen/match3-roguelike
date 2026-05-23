import { useGameStore } from '../../core/state/store'
import { BOARD_HEIGHT, BOARD_WIDTH } from '../../types'

// 8×8 absolute-positioned grid layered on top of the Pixi board. One
// flame indicator per cell whose `flags.burning > 0`. Sits inside the
// board-shell so it scales with the board automatically.
// pointer-events: none — drags and clicks still hit the Pixi canvas.
export function BurningOverlay() {
  const cells = useGameStore((s) => s.board.cells)
  return (
    <div className="burning-overlay" aria-hidden>
      {Array.from({ length: BOARD_HEIGHT }, (_, y) =>
        Array.from({ length: BOARD_WIDTH }, (_, x) => {
          const burning = cells[y]?.[x]?.flags?.burning
          if (!burning || burning <= 0) return null
          return (
            <span
              key={`${x}-${y}`}
              className="burning-cell"
              style={{ gridColumn: x + 1, gridRow: y + 1 }}
              title={`Burning — ${burning} turn${burning === 1 ? '' : 's'} left. Matching this tile gives you Burn.`}
            >
              🔥
            </span>
          )
        }),
      )}
    </div>
  )
}
