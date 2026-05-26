import type {
  DamageSource,
  Enemy,
  GameEvent,
  JsonValue,
  Match,
  PendingSpellId,
  Player,
  RelicRarity,
} from '../../types'

export type MatchPayload = {
  match: Match
  deltas: { red: number; blue: number; green: number; yellow: number; purple: number; gold: number }
  cascadeLevel: number
}

export type DamageDealtPayload = {
  amount: number
  targetId: string
  source: DamageSource
}

export type DamageTakenPayload = {
  amount: number
  blocked: number
  source: DamageSource
  attackerId: string | null
}

export type FatalInterceptResult = {
  prevented: boolean
  hpFloor: number
  relicId: string
}

export type HookCtx = {
  state: FightSnapshot
  relicId: string
  getRunFlag: (key: string) => JsonValue | undefined
  setRunFlag: (key: string, value: JsonValue) => void
  getFightFlag: (key: string) => JsonValue | undefined
  setFightFlag: (key: string, value: JsonValue) => void
  emit: (event: GameEvent) => void
  upgraded: boolean
}

export type FightSnapshot = {
  player: Player
  enemies: readonly Enemy[]
  targetEnemyId: string | null
  cascadeLevel: number
}

export type Modifier<P> = (payload: P, ctx: HookCtx) => P
export type Listener<E> = (event: E, ctx: HookCtx) => void
export type FatalInterceptor = (
  payload: { incoming: number; source: DamageSource },
  ctx: HookCtx,
) => FatalInterceptResult | null

export type RelicDef = {
  id: string
  name: string
  rarity: RelicRarity
  icon: string
  description: string
  orderHint?: string
  upgradable?: boolean
  upgradedDescription?: string
  hooks: {
    onMatch?: Modifier<MatchPayload>
    onCascade?: Listener<{ level: number }>
    onPhaseStart?: Listener<{ phaseKind: 'player' | 'enemy' }>
    onPhaseEnd?: Listener<{ phaseKind: 'player' | 'enemy' }>
    onDamageDealt?: Modifier<DamageDealtPayload>
    onDamageTaken?: Listener<DamageTakenPayload>
    onBlockGained?: Listener<{ amount: number; target: 'player' | string }>
    onBlockBroken?: Listener<{ target: 'player' | string }>
    onEnemyIntent?: Listener<{ enemyId: string }>
    onSpellCast?: Listener<{ spellId: PendingSpellId }>
    onUltimateUsed?: Listener<{ spellId: PendingSpellId }>
    onEnemyKilled?: Listener<{ enemyId: string }>
    onFatalDamage?: FatalInterceptor
    onRelicGained?: Listener<{ relicId: string }>
    onRoundStarted?: Listener<{ fightId: number }>
  }
}

export type HookKind = keyof RelicDef['hooks']
