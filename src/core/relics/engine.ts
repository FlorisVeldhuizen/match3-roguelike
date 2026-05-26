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

// The relic engine is a pure orchestrator: it walks the player's
// acquisition-ordered RelicInstance[] and calls each one's hook function,
// threading a context that lets hooks read snapshot state, read/write
// per-relic flag bags, and emit follow-up events.
//
// Two flavors:
// - runModifiers: payload-in, payload-out filter chain (acquisition order)
// - runListeners: fan-out, no return; hooks emit events via ctx
//
// onFatalDamage is special: it's an interceptor — the first hook in
// acquisition order that returns `{prevented:true}` wins and stops the chain.

// === Shared ctx builder ==================================================
// Mutates `instances` in place for flag writes. Callers (the store) must
// thread the mutated array back into Zustand. Engine doesn't touch the
// outer store; it only edits the array it was given.
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

// === Modifier chain ======================================================
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
    p = hook(p, ctx)
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
    p = hook(p, ctx)
  }
  return { payload: p, events }
}

// === Listener fan-out ====================================================
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

// === Fatal interceptor ===================================================
// Called when a hit *would* drop player HP to ≤0. Walks relics in
// acquisition order; first one to return a `prevented:true` result wins,
// the rest of the chain is skipped, and the caller pins HP to `hpFloor`.
// Returns null if no relic intervenes — caller proceeds to game-over.
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

// === Snapshot helper =====================================================
export function snapshotOf(
  player: Player,
  enemies: readonly Enemy[],
  targetEnemyId: string | null,
  cascadeLevel = 0,
): FightSnapshot {
  return { player, enemies, targetEnemyId, cascadeLevel }
}

// === Acquisition ========================================================
export function acquireRelic(relics: RelicInstance[], id: string): RelicInstance[] {
  if (relics.some((r) => r.id === id)) return relics
  const inst: RelicInstance = { id, runFlags: {}, fightFlags: {} }
  return [...relics, inst]
}

export function resetFightFlags(relics: RelicInstance[]): RelicInstance[] {
  return relics.map((r) => ({ ...r, fightFlags: {} }))
}
