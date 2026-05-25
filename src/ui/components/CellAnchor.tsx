import { forwardRef } from 'react'
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'
import type { CellTransition } from '../hooks/useAnimatedCellPositions'

// Positions a `<span>` over logical cell (x, y) on the 8×8 board grid
// inside an overlay container (e.g. .burning-overlay). Encapsulates the
// percent-step math (100/8 = 12.5% per cell) and the swap/gravity
// transition mirroring so every cell-anchored overlay reads from the
// same primitive — flames, sparkles, future petrify/freeze/hex glyphs.
//
// `transition` semantics, by tri-state:
//   - undefined: no `transition` style emitted; CSS defaults win (used
//                for static FX bursts where snapping is correct).
//   - null:      `transition: none` — explicit "snap, don't interpolate"
//                (used for the placement frame of moving decorations).
//   - object:    mirrors the in-flight gem tween's duration + bezier so
//                the decoration slides in lockstep with its gem.

const CELL_STEP_PCT = 12.5

export type CellAnchorProps = {
  x: number
  y: number
  transition?: CellTransition | null
} & Omit<HTMLAttributes<HTMLSpanElement>, 'style'> & {
    style?: CSSProperties
    children?: ReactNode
  }

export const CellAnchor = forwardRef<HTMLSpanElement, CellAnchorProps>(
  function CellAnchor({ x, y, transition, style, children, ...rest }, ref) {
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
  },
)
