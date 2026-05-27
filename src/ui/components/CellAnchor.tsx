import { forwardRef } from 'react'
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'
import type { CellTransition } from '../hooks/useAnimatedCellPositions'

// 100/8 = 12.5% per cell on the 8×8 board
const CELL_STEP_PCT = 12.5

export type CellAnchorProps = {
  x: number
  y: number
  transition?: CellTransition | null
} & Omit<HTMLAttributes<HTMLSpanElement>, 'style'> & {
    style?: CSSProperties
    children?: ReactNode
  }

export const CellAnchor = forwardRef<HTMLSpanElement, CellAnchorProps>(function CellAnchor(
  { x, y, transition, style, children, ...rest },
  ref,
) {
  const merged: CSSProperties = {
    left: `${x * CELL_STEP_PCT}%`,
    top: `${y * CELL_STEP_PCT}%`,
    ...(transition !== undefined && {
      transition:
        transition === null
          ? 'none'
          : `left ${transition.durationMs}ms ${transition.bezier}, top ${transition.durationMs}ms ${transition.bezier}`,
    }),
    ...style,
  }
  return (
    <span ref={ref} style={merged} {...rest}>
      {children}
    </span>
  )
})
