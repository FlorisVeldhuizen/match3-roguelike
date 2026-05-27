export type BoardCellImpactVariant = 'stone' | 'flame' | 'hex' | 'smash'

export const BOARD_CELL_IMPACT_MS = 680

const CHIP_COUNT = 5

export function BoardCellImpact({ variant }: { variant: BoardCellImpactVariant }) {
  return (
    <>
      <span className={`board-cell-impact-core is-${variant}`} aria-hidden />
      {Array.from({ length: CHIP_COUNT }).map((_, i) => (
        <span
          key={i}
          className={`board-cell-impact-chip is-${variant} chip-${i + 1}`}
          aria-hidden
        />
      ))}
    </>
  )
}
