import type {
  DamageSource,
  Enemy,
  GameEvent,
  Player,
  RelicInstance,
} from '../../types'
import { getRelic } from './registry'
import type {
  DamageDealtPayload,
  DamageTakenPayload,
  FatalInterceptResult,
  FightSnapshot,
  HookCtx,
  HookKind,
  MatchPayload,
  RelicDef,
} from './types'

const MATCH_DELTA_COLORS = [
  'red',
  'blue',
  'green',
  'yellow',
  'purple',
  'gold',
] as const

function matchDeltasEqual(
  a: MatchPayload['deltas'],
  b: MatchPayload['deltas'],
): boolean {
  return MATCH_DELTA_COLORS.every((c) => a[c] === b[c])
}

function describeMatchDeltaChange(
  before: MatchPayload['deltas'],
  after: MatchPayload['deltas'],
): string {
  const parts: string[] = []
  for (const color of MATCH_DELTA_COLORS) {
    const diff = after[color] - before[color]
    if (diff > 0) parts.push(`+${diff} ${color}`)
  }
  return parts.join(', ') || 'bonus applied'
}

function relicTriggeredThisPass(
  events: GameEvent[],
  relicId: string,
): boolean {
  return events.some(
    (e) => e.kind === 'relic-triggered' && e.relicId === relicId,
  )
}

function buildCtx(
  inst: RelicInstance,
  snapshot: FightSnapshot,
  emit: (event: GameEvent) => void,
): HookCtx {
  return {
    state: snapshot,
    relicId: inst.id,
    getRunFlag: (key) => inst.runFlags[key],
    setRunFlag: (key, value) => {
      inst.runFlags[key] = value
    },
    getFightFlag: (key) => inst.fightFlags[key],
    setFightFlag: (key, value) => {
      inst.fightFlags[key] = value
    },
    emit,
    upgraded: inst.upgraded === true,
  }
}

function getHook<K extends HookKind>(
  def: RelicDef,
  kind: K,
): RelicDef['hooks'][K] {
  return def.hooks[kind]
}

export type EngineRunResult<P> = {
  payload: P
  events: GameEvent[]
}

export function runOnMatch(
  payload: MatchPayload,
  instances: RelicInstance[],
  snapshot: FightSnapshot,
): EngineRunResult<MatchPayload> {
  const events: GameEvent[] = []
  let p = payload
  for (const inst of instances) {
    const def = getRelic(inst.id)
    const hook = getHook(def, 'onMatch')
    if (!hook) continue
    const ctx = buildCtx(inst, snapshot, (e) => events.push(e))
    const before = p.deltas
    p = hook(p, ctx)
    if (
      !matchDeltasEqual(before, p.deltas) &&
      !relicTriggeredThisPass(events, inst.id)
    ) {
      events.push({
        kind: 'relic-triggered',
        relicId: inst.id,
        effect: describeMatchDeltaChange(before, p.deltas),
      })
    }
  }
  return { payload: p, events }
}

export function runOnDamageDealt(
  payload: DamageDealtPayload,
  instances: RelicInstance[],
  snapshot: FightSnapshot,
): EngineRunResult<DamageDealtPayload> {
  const events: GameEvent[] = []
  let p = payload
  for (const inst of instances) {
    const def = getRelic(inst.id)
    const hook = getHook(def, 'onDamageDealt')
    if (!hook) continue
    const ctx = buildCtx(inst, snapshot, (e) => events.push(e))
    const before = p.amount
    p = hook(p, ctx)
    if (
      p.amount !== before &&
      !relicTriggeredThisPass(events, inst.id)
    ) {
      const diff = p.amount - before
      events.push({
        kind: 'relic-triggered',
        relicId: inst.id,
        effect: diff > 0 ? `+${diff} damage` : `${diff} damage`,
      })
    }
  }
  return { payload: p, events }
}

function runListener<K extends HookKind, E>(
  kind: K,
  event: E,
  instances: RelicInstance[],
  snapshot: FightSnapshot,
): GameEvent[] {
  const events: GameEvent[] = []
  for (const inst of instances) {
    const def = getRelic(inst.id)
    const hook = getHook(def, kind) as
      | ((e: E, ctx: HookCtx) => void)
      | undefined
    if (!hook) continue
    const ctx = buildCtx(inst, snapshot, (ev) => events.push(ev))
    hook(event, ctx)
  }
  return events
}

export function runOnDamageTaken(
  event: DamageTakenPayload,
  instances: RelicInstance[],
  snapshot: FightSnapshot,
): GameEvent[] {
  return runListener('onDamageTaken', event, instances, snapshot)
}

export function runOnBlockGained(
  event: { amount: number; target: 'player' | string },
  instances: RelicInstance[],
  snapshot: FightSnapshot,
): GameEvent[] {
  return runListener('onBlockGained', event, instances, snapshot)
}

export function runOnBlockBroken(
  event: { target: 'player' | string },
  instances: RelicInstance[],
  snapshot: FightSnapshot,
): GameEvent[] {
  return runListener('onBlockBroken', event, instances, snapshot)
}

export function runOnEnemyKilled(
  event: { enemyId: string },
  instances: RelicInstance[],
  snapshot: FightSnapshot,
): GameEvent[] {
  return runListener('onEnemyKilled', event, instances, snapshot)
}

export function runOnSpellCast(
  event: { spellId: import('../../types').PendingSpellId },
  instances: RelicInstance[],
  snapshot: FightSnapshot,
): GameEvent[] {
  return runListener('onSpellCast', event, instances, snapshot)
}

export function runOnUltimateUsed(
  event: { spellId: import('../../types').PendingSpellId },
  instances: RelicInstance[],
  snapshot: FightSnapshot,
): GameEvent[] {
  return runListener('onUltimateUsed', event, instances, snapshot)
}

export function runOnPhaseStart(
  event: { phaseKind: 'player' | 'enemy' },
  instances: RelicInstance[],
  snapshot: FightSnapshot,
): GameEvent[] {
  return runListener('onPhaseStart', event, instances, snapshot)
}

export function runOnPhaseEnd(
  event: { phaseKind: 'player' | 'enemy' },
  instances: RelicInstance[],
  snapshot: FightSnapshot,
): GameEvent[] {
  return runListener('onPhaseEnd', event, instances, snapshot)
}

export function runOnCascade(
  event: { level: number },
  instances: RelicInstance[],
  snapshot: FightSnapshot,
): GameEvent[] {
  return runListener('onCascade', event, instances, snapshot)
}

export function runOnEnemyIntent(
  event: { enemyId: string },
  instances: RelicInstance[],
  snapshot: FightSnapshot,
): GameEvent[] {
  return runListener('onEnemyIntent', event, instances, snapshot)
}

export function runOnRelicGained(
  event: { relicId: string },
  instances: RelicInstance[],
  snapshot: FightSnapshot,
): GameEvent[] {
  return runListener('onRelicGained', event, instances, snapshot)
}

export function runOnRoundStarted(
  event: { fightId: number },
  instances: RelicInstance[],
  snapshot: FightSnapshot,
): GameEvent[] {
  return runListener('onRoundStarted', event, instances, snapshot)
}

// First relic in acquisition order that returns prevented:true wins
export function interceptFatalDamage(
  payload: { incoming: number; source: DamageSource },
  instances: RelicInstance[],
  snapshot: FightSnapshot,
): { result: FatalInterceptResult | null; events: GameEvent[] } {
  const events: GameEvent[] = []
  for (const inst of instances) {
    const def = getRelic(inst.id)
    const hook = def.hooks.onFatalDamage
    if (!hook) continue
    const ctx = buildCtx(inst, snapshot, (e) => events.push(e))
    const result = hook(payload, ctx)
    if (result && result.prevented) {
      return { result, events }
    }
  }
  return { result: null, events }
}

export function snapshotOf(
  player: Player,
  enemies: readonly Enemy[],
  targetEnemyId: string | null,
  cascadeLevel = 0,
): FightSnapshot {
  return { player, enemies, targetEnemyId, cascadeLevel }
}

/**
 * Writable relic copies for hook side effects.
 * Zustand+Immer freezes objects from get(); relic hooks must not mutate those
 * snapshots. Clone before relic engine runners (runOn…, interceptFatalDamage),
 * assign the returned array back onto player.relics when hooks may call
 * setRunFlag or setFightFlag.
 */
export function cloneRelicsForHooks(relics: readonly RelicInstance[]): RelicInstance[] {
  return relics.map((r) => ({
    ...r,
    runFlags: { ...r.runFlags },
    fightFlags: { ...r.fightFlags },
  }))
}

export function acquireRelic(relics: RelicInstance[], id: string): RelicInstance[] {
  if (relics.some((r) => r.id === id)) return relics
  const inst: RelicInstance = { id, runFlags: {}, fightFlags: {} }
  return [...relics, inst]
}

export function resetFightFlags(relics: RelicInstance[]): RelicInstance[] {
  return relics.map((r) => ({ ...r, fightFlags: {} }))
}
