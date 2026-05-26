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

// === Payloads ============================================================
// Modifier hooks transform a payload and return it. Listeners receive a
// payload + a ctx and may emit follow-up events. The split is documented
// per hook in RelicDef below.

// onMatch fires once per match-found in cascade order. Relics adjust the
// deltas before the walker commits them (red→damage, green→heal, blue→pool,
// yellow→mana, purple→skill charge). Only one color is non-zero on entry —
// the match's own color × cascade multiplier — but relics can inject deltas
// in other colors (no Phase G relic does, but the surface is open).
export type MatchPayload = {
  match: Match
  // Phase I: gold delta is a new currency lane (player.gold, not mana).
  // Only non-zero on a gold-color match; relic hooks could amplify it
  // (no Phase I relic does, but the surface is open for future Midas-
  // style relics).
  deltas: { red: number; blue: number; green: number; yellow: number; purple: number; gold: number }
  cascadeLevel: number
}

// onDamageDealt — modifier; runs before the damage is applied. Lets future
// relics scale outgoing player damage (no Phase G relic uses it, but the
// chain is wired so J2 doesn't need engine churn).
export type DamageDealtPayload = {
  amount: number
  targetId: string
  source: DamageSource
}

// onDamageTaken — listener; the hit has already been resolved against
// block/HP when this fires (so Thornmail reads the *original* incoming
// damage from the payload, not a re-derived number).
export type DamageTakenPayload = {
  amount: number
  blocked: number
  source: DamageSource
  attackerId: string | null
}

// onFatalDamage — interceptor; runs before the hit lands when the projected
// hpAfter would be ≤ 0. Returning {prevented:true, hpFloor:N} short-circuits
// the chain and pins HP to N (Stoneheart sets 1). Order: first relic in
// acquisition order that prevents wins.
export type FatalInterceptResult = {
  prevented: boolean
  hpFloor: number
  relicId: string
}

// === Hook ctx ============================================================
// What hooks can see and do without crossing into Zustand/UI. Read-only
// snapshot of fight state + per-relic flag accessors + an event emitter
// that appends to the outgoing event stream.
export type HookCtx = {
  state: FightSnapshot
  relicId: string
  getRunFlag: (key: string) => JsonValue | undefined
  setRunFlag: (key: string, value: JsonValue) => void
  getFightFlag: (key: string) => JsonValue | undefined
  setFightFlag: (key: string, value: JsonValue) => void
  emit: (event: GameEvent) => void
  // Phase I: true when the relic was upgraded at a rest node. Relics
  // that opt into upgradability (RelicDef.upgradable === true) read this
  // to double their primary numeric. Non-opt-in relics ignore it.
  upgraded: boolean
}

export type FightSnapshot = {
  player: Player
  enemies: readonly Enemy[]
  targetEnemyId: string | null
  cascadeLevel: number
}

// === Hook flavors ========================================================
export type Modifier<P> = (payload: P, ctx: HookCtx) => P
export type Listener<E> = (event: E, ctx: HookCtx) => void
export type FatalInterceptor = (
  payload: { incoming: number; source: DamageSource },
  ctx: HookCtx,
) => FatalInterceptResult | null

// === Relic def ===========================================================
export type RelicDef = {
  id: string
  name: string
  rarity: RelicRarity
  icon: string
  description: string
  // Ordering hint shown in the tooltip when an effect is order-sensitive.
  // J2 will lean on this; Phase G uses it for Cascade Crystal.
  orderHint?: string
  // Phase I: opt into rest-node upgrades. When true, the relic's hook is
  // expected to honor ctx.upgraded (usually by doubling its primary
  // numeric — see content/relics.ts for canonical pattern). Defaults to
  // false; non-numeric relics like Stoneheart or hard-to-balance
  // multipliers like Cascade Crystal keep their base values.
  upgradable?: boolean
  // Optional alt description rendered when the relic instance is
  // upgraded — keeps the tooltip honest about the active numbers.
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
