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

export type DamageSource = 'enemy-attack' | 'player-attack'

export type GameEvent =
  | { kind: 'swap'; from: Pos; to: Pos }
  | { kind: 'swap-reverted'; from: Pos; to: Pos }
  | {
      kind: 'match-found'
      cells: Pos[]
      color: GemColor
      size: number
      shape: MatchShape
      // Set by the store on the first 4+ match of a swap when the bonus turn
      // will actually be granted. Drives the in-cascade "+1 TURN" feedback.
      grantsExtraTurn?: boolean
    }
  | { kind: 'cascade-start'; level: number }
  // Emitted once after a swap's cascade loop fully resolves. `levels` is the
  // total number of chain links (1 = just the initial match, 2+ = at least
  // one chain). Used by the SFX layer to play a celebration on good chains.
  | { kind: 'cascade-complete'; levels: number }
  | { kind: 'gems-cleared'; cells: Pos[] }
  | { kind: 'gems-fell'; movements: { from: Pos; to: Pos }[] }
  | { kind: 'gems-spawned'; spawns: { at: Pos; color: GemColor }[] }
  | { kind: 'board-shuffled'; cells: { at: Pos; color: GemColor }[] }
  | { kind: 'pool-gained'; color: GemColor; amount: number }
  | {
      kind: 'damage-dealt'
      targetId: string
      // amount = HP damage to the target. blocked = portion absorbed by
      // target.block. Total incoming = amount + blocked. Mirrors damage-taken.
      amount: number
      blocked: number
      source: DamageSource
    }
  | { kind: 'damage-taken'; amount: number; blocked: number; source: DamageSource }
  | { kind: 'block-gained'; amount: number }
  | { kind: 'enemy-block-gained'; enemyId: string; amount: number }
  | { kind: 'block-absorbed'; targetId: 'player' | string }
  | { kind: 'block-broken'; targetId: 'player' | string }
  | { kind: 'healed'; amount: number }
  | { kind: 'enemy-killed'; enemyId: string }
  | { kind: 'intent-telegraphed'; enemyId: string; intent: Intent }
  | { kind: 'extra-turn-granted' }
  | { kind: 'turn-ended' }
  | { kind: 'phase-changed'; phase: CombatPhase }
  | { kind: 'screen-shake'; magnitude: number }

export type CombatPhase =
  | 'player-acting'
  | 'resolving'
  | 'player-phase-end'
  | 'enemy-acting'
  | 'enemy-end'
  | 'victory'
  | 'game-over'

export type IntentKind = 'attack' | 'block'

export type Intent =
  | { kind: 'attack'; amount: number }
  | { kind: 'block'; amount: number }

export type EnemyArchetype = 'brute'

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
  archetype: EnemyArchetype
  hp: number
  maxHp: number
  block: number
  currentIntent: Intent
  nextIntentIndex: number
}

export type FightState = {
  phase: CombatPhase
  player: Player
  enemies: Enemy[]
  targetEnemyId: string | null
}
