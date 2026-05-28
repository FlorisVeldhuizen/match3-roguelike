export type GemColor = 'red' | 'blue' | 'green' | 'yellow' | 'purple' | 'gold'

export const GEM_COLORS: readonly GemColor[] = [
  'red',
  'blue',
  'green',
  'yellow',
  'purple',
  'gold',
] as const

export const MANA_GEM_COLORS: readonly GemColor[] = [
  'red',
  'blue',
  'green',
  'yellow',
  'purple',
] as const

export type CellFlags = {
  burning?: number
  blessed?: true
  pendingShove?: { dst: Pos; sourceEnemyId: string }
}

// Row index → turns remaining. Position-bound (doesn't travel with gems).
export type PetrifiedRows = Record<number, number>

/** Player Frozen Wall — blocks enemy board verbs on that row; does not lock swaps. */
export type WardedRows = Record<number, number>

export type Cell = {
  gemColor: GemColor
  flags?: CellFlags
}

export type Pos = { x: number; y: number }

export const BOARD_WIDTH = 8
export const BOARD_HEIGHT = 8

// 'shatter' is synthetic — drives match-found without T/L AOE or blessed.
export type MatchShape = 'line' | 'T' | 'L' | 'shatter'

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
  | 'thornmail'
  | 'relic-effect'

export type StatusKind = 'burn' | 'vulnerable' | 'weak' | 'regen' | 'strength'

export type StatusInstance = {
  kind: StatusKind
  stacks: number
}

export type SpellId =
  | 'bulwark'
  | 'reinforce'
  | 'volley'
  | 'focus'
  | 'ignite'
  | 'regenerate'
  | 'purify'
  | 'skewer'
  | 'brittle'
  | 'surge'
  | 'cinder-lash'
  | 'shatter'
  | 'transmute'
  | 'blessed-ground'
  | 'frozen-wall'
  | 'chain-lightning'
export type UltimateId = 'riposte'
export type PendingSpellId = SpellId | UltimateId

export type SpellResolution = 'pending' | 'immediate'

export type SpellVisualBeat = {
  spellId: PendingSpellId
  trailStartMs: number
  arriveMs: number
}

export type SpellEffectPalette =
  | 'burn'
  | 'vulnerable'
  | 'regen'
  | 'weak'
  | 'strength'
  | 'attack'
  | 'heal'

export type SpellEffectLeg = {
  palette: SpellEffectPalette
  dest:
    | { kind: 'enemy'; enemyId: string; slot: 'status' | 'hp' }
    | { kind: 'player'; slot: 'hp' | 'status' | 'block' }
    | { kind: 'board'; cells: Pos[] }
  staggerMs?: number
}

/** Why a trail was spawned — drives HUD / SFX / overlay sync. */
export type TrailPurpose =
  | 'pool-earn'
  | 'mana-spend'
  | 'spell-effect'
  | 'status-apply'
  | 'status-proc'
  | 'player-attack'
  | 'verb-to-board'

export type TrailScheduledEvent = {
  kind: 'trail-scheduled'
  purpose: TrailPurpose
  /** Ms from now until the last particle arrives. */
  arrivalMs: number
  target?: 'player' | string
  color?: GemColor
  /** pool-earn: mana/pool increment shown when this trail lands */
  amount?: number
  /** pool-earn: shield/HP target vs mana chip (split trails) */
  earnDest?: 'effect' | 'mana'
  statusKind?: StatusKind
  /** status-proc: damage chip→HP vs chip→block */
  procFacet?: 'damage' | 'block'
  spellId?: PendingSpellId
  /** spell-effect: which HUD slot the trail homed to */
  slot?: 'hp' | 'block' | 'status'
  verb?: 'tile-burn' | 'color-hex' | 'color-drain' | 'petrify' | 'frozen-wall'
  /** verb-to-board: board cell this trail burst targets */
  at?: Pos
  /** verb-to-board: play one-shot apply SFX when the slowest cell in the burst lands */
  verbBurstEnd?: boolean
}

export type GameEvent =
  | { kind: 'swap'; from: Pos; to: Pos }
  | { kind: 'swap-reverted'; from: Pos; to: Pos }
  | {
      kind: 'match-found'
      cells: Pos[]
      color: GemColor
      size: number
      shape: MatchShape
      grantsExtraTurn?: boolean
      blessed?: boolean
    }
  | { kind: 'cascade-start'; level: number }
  | { kind: 'cascade-complete'; levels: number }
  | { kind: 'gems-cleared'; cells: Pos[] }
  | { kind: 'gems-fell'; movements: { from: Pos; to: Pos }[] }
  | { kind: 'gems-spawned'; spawns: { at: Pos; color: GemColor }[] }
  | { kind: 'gems-transmuted'; cells: { at: Pos; color: GemColor }[] }
  | { kind: 'board-shuffled'; cells: { at: Pos; color: GemColor }[] }
  | { kind: 'board-swept' }
  | { kind: 'board-intro-landed'; column: number }
  | { kind: 'pool-gained'; color: GemColor; amount: number }
  | {
      kind: 'damage-dealt'
      targetId: string
      amount: number
      blocked: number
      source: DamageSource
      spellVisual?: SpellVisualBeat
    }
  | {
      kind: 'damage-taken'
      amount: number
      blocked: number
      source: DamageSource
      attackerId?: string
      onHitRider?: StatusKind
    }
  | {
      kind: 'status-applied'
      target: 'player' | string
      status: StatusInstance
      source?:
        | { kind: 'enemy'; enemyId: string }
        | { kind: 'board-cells'; cells: Pos[] }
        | { kind: 'player' }
      spellVisual?: SpellVisualBeat
    }
  | {
      kind: 'status-ticked'
      target: 'player' | string
      statusKind: StatusKind
      remaining: number
    }
  | {
      kind: 'status-expired'
      target: 'player' | string
      statusKind: StatusKind
      spellVisual?: SpellVisualBeat
    }
  | {
      kind: 'spell-cast'
      spellId: PendingSpellId
      spentColors: readonly ('red' | 'blue' | 'green' | 'yellow' | 'purple')[]
    }
  | { kind: 'pending-effect-resolved'; spellId: PendingSpellId }
  | {
      kind: 'spell-effect-trail'
      spellId: PendingSpellId
      legs: SpellEffectLeg[]
      trailStartMs: number
      arriveMs: number
    }
  | { kind: 'riposte-counter'; targetId: string; amount: number }
  | {
      kind: 'tile-burn-placed'
      cells: Pos[]
      enemyId: string
      duration: number
    }
  | { kind: 'column-smash-placed'; enemyId: string; column: number; cells: Pos[] }
  | { kind: 'column-smash-resolved'; enemyId: string; column: number; cells: Pos[] }
  | { kind: 'petrify-placed'; enemyId: string; row: number; cells: Pos[]; duration: number }
  | { kind: 'petrify-fired'; enemyId: string; row: number; duration: number }
  | { kind: 'petrify-row-ticked'; row: number; remaining: number }
  | { kind: 'frozen-wall-fired'; row: number; duration: number }
  | { kind: 'frozen-wall-ticked'; row: number; remaining: number }
  | { kind: 'frozen-wall-blocked'; row: number; verb: IntentKind }
  | { kind: 'color-hex-placed'; enemyId: string; color: GemColor }
  | { kind: 'color-hex-fired'; enemyId: string; color: GemColor; turnsLeft: number }
  | { kind: 'color-hex-ticked'; color: GemColor; remaining: number }
  | { kind: 'hex-triggered'; color: GemColor; stacks: number; cells: Pos[] }
  | {
      kind: 'cluster-shove-placed'
      enemyId: string
      sources: Pos[]
      destinations: Pos[]
    }
  | {
      kind: 'cluster-shove-resolved'
      enemyId: string
      moves: { source: Pos; destination: Pos; color: GemColor }[]
    }
  | { kind: 'tile-burn-triggered'; cells: Pos[] }
  | { kind: 'tile-blessed-placed'; cells: Pos[]; color: GemColor }
  | { kind: 'blessed-match-triggered'; cells: Pos[]; count: number }
  | {
      kind: 'cell-flag-ticked'
      positions: Pos[]
      expired: Pos[]
      flag: keyof CellFlags
    }
  | { kind: 'block-gained'; amount: number; spellVisual?: SpellVisualBeat }
  | { kind: 'enemy-block-gained'; enemyId: string; amount: number }
  | { kind: 'block-absorbed'; targetId: 'player' | string }
  | { kind: 'block-broken'; targetId: 'player' | string }
  | { kind: 'healed'; amount: number; spellVisual?: SpellVisualBeat }
  | { kind: 'enemy-killed'; enemyId: string }
  | { kind: 'ally-healed'; sourceId: string; targetId: string; amount: number }
  | { kind: 'ally-shielded'; sourceId: string; targetId: string; amount: number }
  | { kind: 'enemy-staggered'; enemyId: string }
  | { kind: 'enemy-acted'; enemyId: string }
  | { kind: 'intent-telegraphed'; enemyId: string; intent: Intent }
  | { kind: 'extra-turn-granted' }
  | { kind: 'turn-ended' }
  | { kind: 'phase-changed'; phase: CombatPhase }
  | { kind: 'screen-shake'; magnitude: number }
  | { kind: 'relic-triggered'; relicId: string; effect: string }
  | { kind: 'relic-gained'; relicId: string }
  | {
      kind: 'reward-offered'
      offerKind: 'relic' | 'spell'
      offeredRelicIds: string[]
      offeredSpellIds: SpellId[]
      gold: number
    }
  | { kind: 'board-hover'; cell: Pos | null }
  | { kind: 'gameplay-settled' }
  | { kind: 'enemy-enraged'; enemyId: string }
  | { kind: 'color-drain-placed'; enemyId: string; color: GemColor }
  | {
      kind: 'color-drain-fired'
      enemyId: string
      color: GemColor
      turnsLeft: number
    }
  | { kind: 'color-drain-ticked'; color: GemColor; remaining: number }
  | {
      kind: 'drain-triggered'
      color: GemColor
      healAmount: number
      enemyId: string
      cells: Pos[]
    }
  | {
      kind: 'trick-swapped'
      enemyId: string
      telegraphed: IntentKind
      actual: IntentKind
    }
  /** Store mana/charge changed without combat trails (e.g. debug fill). */
  | { kind: 'hud-resources-sync'; mana: ManaPools; skillCharge: number }
  | TrailScheduledEvent

export type CombatPhase = 'player-acting' | 'enemy-acting' | 'victory' | 'game-over'

export type IntentKind =
  | 'attack'
  | 'block'
  | 'tile-burn'
  | 'heal-ally'
  | 'buff-ally'
  | 'shield-ally'
  | 'column-smash'
  | 'petrify-row'
  | 'color-hex'
  | 'cluster-shove'
  | 'color-drain'
  | 'trick'

export type IntentOnHit = {
  status: StatusKind
  stacks: number
}

export type Intent =
  | { kind: 'attack'; amount: number; onHit?: IntentOnHit; lifesteal?: number }
  | { kind: 'block'; amount: number }
  | { kind: 'tile-burn'; count: number }
  | { kind: 'heal-ally'; amount: number; targetAllyId: string }
  | { kind: 'buff-ally'; stacks: number; targetAllyId: string }
  | { kind: 'shield-ally'; amount: number; targetAllyId: string }
  | { kind: 'column-smash'; column: number }
  | { kind: 'petrify-row'; row: number }
  | { kind: 'color-hex'; color: GemColor }
  | { kind: 'cluster-shove'; sources: Pos[]; destinations: Pos[] }
  | { kind: 'color-drain'; color: GemColor }
  | { kind: 'trick'; resolved: Intent }

export type EnemyArchetype =
  | 'brute'
  | 'smolder'
  | 'skirmisher'
  | 'rallier'
  | 'defender'
  | 'caster'
  | 'swarmer'
  | 'tyrant'
  | 'leech'
  | 'shade'
  | 'trickster'

export type PhasePools = {
  red: number
  blue: number
  green: number
}

export type ManaPools = {
  red: number
  blue: number
  green: number
  yellow: number
}

// Yellow caps lower (5) because it's universally useful as wild mana.
export const MANA_CAPS: Readonly<ManaPools> = {
  red: 8,
  blue: 8,
  green: 8,
  yellow: 5,
}

export type ManaCost = {
  red?: number
  blue?: number
  green?: number
  yellow?: number
}

export type RelicInstance = {
  id: string
  runFlags: Record<string, JsonValue>
  fightFlags: Record<string, JsonValue>
  upgraded?: boolean
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue }

export type Player = {
  hp: number
  maxHp: number
  block: number
  mana: ManaPools
  skillCharge: number
  phasePools: PhasePools
  statuses: StatusInstance[]
  pendingSpells: PendingSpellId[]
  volleyTargets?: string[]
  skewerArmed?: boolean
  surgeArmed?: boolean
  chainLightningArmed?: boolean
  carryBlockNextPhase: boolean
  relics: RelicInstance[]
  gold: number
  ownedSpellIds: SpellId[]
}

export type PendingReward =
  | {
      kind: 'relic'
      rarity: RelicRarity
      offeredRelicIds: string[]
      gold: number
    }
  | {
      kind: 'spell'
      offeredSpellIds: SpellId[]
      gold: number
    }

export type RelicRarity = 'common' | 'uncommon' | 'rare'

export type ShopOffer = {
  relics: {
    id: string
    cost: number
    purchased: boolean
  }[]
  spells: {
    id: SpellId
    cost: number
    purchased: boolean
  }[]
  heals: {
    kind: 'small' | 'big'
    cost: number
    amount: number
    purchased: boolean
  }[]
  pawnOffer: { used: boolean } | null
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
  enraged?: boolean
}

export type DrainedColor = { color: GemColor; enemyId: string; turnsLeft: number }

export type FightState = {
  phase: CombatPhase
  player: Player
  enemies: Enemy[]
  targetEnemyId: string | null
  isBoss?: boolean
  isElite?: boolean
  hexedColors?: HexedColor[]
  drainedColors?: DrainedColor[]
}

export type HexedColor = { color: GemColor; turnsLeft: number }

export type NodeKind = 'fight' | 'elite' | 'shop' | 'rest' | 'boss'

export type MapNode = {
  id: string
  kind: NodeKind
  column: number
  lane: number
  archetypes?: EnemyArchetype[]
}

export type MapEdge = { from: string; to: string }

export type MapState = {
  nodes: MapNode[]
  edges: MapEdge[]
  currentNodeId: string | null
  completedNodeIds: string[]
}

export type RunPhase = 'map' | 'fight' | 'reward' | 'shop' | 'rest' | 'victory' | 'game-over'
