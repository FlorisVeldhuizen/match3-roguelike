export type GemColor = 'red' | 'blue' | 'green' | 'yellow' | 'purple'

export const GEM_COLORS: readonly GemColor[] = [
  'red',
  'blue',
  'green',
  'yellow',
  'purple',
] as const

// Phase F adds the first board-verb flag: `burning`. The flag carries the
// remaining duration (in player phases). More flags land in H2/J1 — keep
// the bag open-ended so each verb plugs in without re-shaping Cell.
export type CellFlags = {
  burning?: number
}

export type Cell = {
  gemColor: GemColor
  flags?: CellFlags
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
  | 'player-attack'
  | 'burn'
  | 'riposte'

export type StatusKind = 'burn' | 'vulnerable' | 'weak'

// One number per status (Slay-the-Spire pattern). `stacks` is both
// "magnitude" and "turns left" — every tick decrements stacks by 1, and
// for Burn the tick also deals damage equal to current stacks. So a
// Burn 3 deals 3 → 2 → 1 → expires (6 damage over 3 turns). Vulnerable
// and Weak don't tick damage; their multiplier is active as long as
// stacks > 0.
export type StatusInstance = {
  kind: StatusKind
  stacks: number
}

export type SpellId = 'bulwark' | 'reinforce'
export type UltimateId = 'riposte'
export type PendingSpellId = SpellId | UltimateId

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
  | {
      kind: 'status-applied'
      target: 'player' | string
      status: StatusInstance
      // Visual hint for the FX layer — where particles should fly *from*.
      // Engine logic doesn't read this. `enemy` for Smolder-on-hit style
      // (caster is the acting enemy), `board-cells` for a tile-burn match
      // that bounces Burn back at the player, `player` for player-applied
      // statuses (none yet, but reserved for relics).
      source?:
        | { kind: 'enemy'; enemyId: string }
        | { kind: 'board-cells'; cells: Pos[] }
        | { kind: 'player' }
    }
  | {
      kind: 'status-ticked'
      target: 'player' | string
      statusKind: StatusKind
      remaining: number
    }
  | { kind: 'status-expired'; target: 'player' | string; statusKind: StatusKind }
  | { kind: 'spell-cast'; spellId: PendingSpellId }
  | { kind: 'pending-effect-resolved'; spellId: PendingSpellId }
  | { kind: 'riposte-counter'; targetId: string; amount: number }
  | {
      kind: 'tile-burn-placed'
      cells: Pos[]
      enemyId: string
      // How many player phases the tiles will stay burning. The
      // BurningOverlay reads this directly instead of probing the
      // store, which avoids picking up a wrong number when an
      // earlier flame is already at a lower remaining count.
      duration: number
    }
  // Emitted when a match clears one or more cells whose `burning` flag was
  // active. Total burn stacks = number of burning cells in the cleared set
  // (one stack per cell per match, per 02-scope §Enemies/Smolder).
  | { kind: 'tile-burn-triggered'; cells: Pos[]; stacks: number }
  | { kind: 'cell-flag-ticked'; positions: Pos[]; flag: keyof CellFlags }
  | { kind: 'block-gained'; amount: number }
  | { kind: 'enemy-block-gained'; enemyId: string; amount: number }
  | { kind: 'block-absorbed'; targetId: 'player' | string }
  | { kind: 'block-broken'; targetId: 'player' | string }
  | { kind: 'healed'; amount: number }
  | { kind: 'enemy-killed'; enemyId: string }
  // Emitted at the start of an enemy turn when the enemy's current intent
  // was `block` and their block is now 0 — the player broke the shield, so
  // the enemy "spent" their turn recovering instead of acting. Drives the
  // "Staggered" banner + enemy-frame recoil.
  | { kind: 'enemy-staggered'; enemyId: string }
  | { kind: 'intent-telegraphed'; enemyId: string; intent: Intent }
  | { kind: 'extra-turn-granted' }
  | { kind: 'turn-ended' }
  | { kind: 'phase-changed'; phase: CombatPhase }
  | { kind: 'screen-shake'; magnitude: number }
  // UI-only signal: the player's cursor is over a board cell (or
  // null = pointer left the board). Emitted by BoardScene when its
  // internal hoveredCell transitions. BurningOverlay listens to react
  // its flames in sync with the gem hover beat.
  | { kind: 'board-hover'; cell: Pos | null }

export type CombatPhase =
  | 'player-acting'
  | 'enemy-acting'
  | 'victory'
  | 'game-over'

export type IntentKind = 'attack' | 'block' | 'tile-burn'

// Optional status rider carried on attack intents. Smolder uses this
// to apply Burn on hit. Surfaced on the intent badge so the player
// sees the rider before the attack lands.
export type IntentOnHit = {
  status: StatusKind
  stacks: number
}

export type Intent =
  | { kind: 'attack'; amount: number; onHit?: IntentOnHit }
  | { kind: 'block'; amount: number }
  | { kind: 'tile-burn'; count: number }

export type EnemyArchetype = 'brute' | 'smolder'

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
  statuses: StatusInstance[]
  // EOP/ultimate effects queued this phase. Bulwark/Reinforce fire and
  // are cleared at EOP; Riposte persists across the enemy turn until it
  // triggers on an incoming attack or expires at the end of that turn.
  pendingSpells: PendingSpellId[]
  // Reinforce sets this at EOP. Next beginPlayerPhase preserves the
  // remaining block (instead of zeroing it) and clears the flag — the
  // phase *after* that zeros normally per 01-design §Reinforce.
  carryBlockNextPhase: boolean
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
  statuses: StatusInstance[]
}

export type FightState = {
  phase: CombatPhase
  player: Player
  enemies: Enemy[]
  targetEnemyId: string | null
}
