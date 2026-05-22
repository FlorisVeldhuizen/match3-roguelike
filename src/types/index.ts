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
  | 'player-attack'

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
  | { kind: 'pool-gained'; color: GemColor; amount: number }
  | { kind: 'damage-dealt'; targetId: string; amount: number; source: DamageSource }
  | { kind: 'damage-taken'; amount: number; blocked: number; source: DamageSource }
  | { kind: 'block-gained'; amount: number }
  | { kind: 'healed'; amount: number }
  | { kind: 'enemy-killed'; enemyId: string }
  | { kind: 'turn-ended' }
  | { kind: 'phase-changed'; phase: CombatPhase }

export type CombatPhase =
  | 'player-acting'
  | 'resolving'
  | 'player-phase-end'
  | 'enemy-acting'
  | 'enemy-end'
  | 'victory'

export type PhasePools = {
  red: number
  blue: number
  green: number
}

export type Player = {
  hp: number
  maxHp: number
  block: number
  mana: number
  skillCharge: number
  phasePools: PhasePools
}

export type Enemy = {
  id: string
  name: string
  hp: number
  maxHp: number
}

export type FightState = {
  phase: CombatPhase
  player: Player
  enemies: Enemy[]
  targetEnemyId: string | null
}
