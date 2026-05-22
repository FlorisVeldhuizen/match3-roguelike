export type GemColor = 'red' | 'blue' | 'green' | 'yellow' | 'purple'

export const GEM_COLORS: readonly GemColor[] = [
  'red',
  'blue',
  'green',
  'yellow',
  'purple',
] as const

export type Cell = {
  gemColor: GemColor
  flags: { cursed?: boolean }
}

export type Pos = { x: number; y: number }

export const BOARD_WIDTH = 8
export const BOARD_HEIGHT = 8

export type MatchShape = 'line' | 'T' | 'L'

export type Match = {
  cells: Pos[]
  color: GemColor
  size: number
  shape: MatchShape
}

export type DamageSource =
  | 'enemy-attack'
  | 'status-dot'
  | 'self-curse'
  | 'spell-cost'
  | 'environment'

export type GameEvent =
  | { kind: 'swap'; from: Pos; to: Pos }
  | { kind: 'swap-reverted'; from: Pos; to: Pos }
  | {
      kind: 'match-found'
      cells: Pos[]
      color: GemColor
      size: number
      shape: MatchShape
    }
  | { kind: 'cascade-start'; level: number }
  | { kind: 'gems-cleared'; cells: Pos[] }
  | { kind: 'gems-fell'; movements: { from: Pos; to: Pos }[] }
  | { kind: 'gems-spawned'; spawns: { at: Pos; color: GemColor }[] }
