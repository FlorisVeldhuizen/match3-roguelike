import type {
  GameEvent,
  PendingSpellId,
  SpellEffectLeg,
  SpellId,
  SpellVisualBeat,
  StatusKind,
} from '../../types'
import {
  SPEND_TRAIL_ARRIVAL_MS,
  SPELL_EFFECT_TRAIL_ARRIVAL_MS,
} from '../../timing'

export type { SpellVisualBeat, SpellEffectLeg } from '../../types'

export function immediateSpellBeat(spellId: PendingSpellId): SpellVisualBeat {
  return {
    spellId,
    trailStartMs: SPEND_TRAIL_ARRIVAL_MS,
    arriveMs: SPEND_TRAIL_ARRIVAL_MS + SPELL_EFFECT_TRAIL_ARRIVAL_MS,
  }
}

export function pendingSpellBeat(spellId: PendingSpellId): SpellVisualBeat {
  return {
    spellId,
    trailStartMs: 0,
    arriveMs: SPELL_EFFECT_TRAIL_ARRIVAL_MS,
  }
}

function statusPalette(kind: StatusKind) {
  switch (kind) {
    case 'burn':
      return 'burn' as const
    case 'vulnerable':
      return 'vulnerable' as const
    case 'regen':
      return 'regen' as const
    case 'weak':
      return 'weak' as const
    case 'strength':
      return 'strength' as const
  }
}

function legsFromEffectEvents(events: readonly GameEvent[]): SpellEffectLeg[] {
  const legs: SpellEffectLeg[] = []
  let attackStagger = 0

  for (const e of events) {
    if (e.kind === 'status-applied' && e.source?.kind === 'player') {
      if (e.target === 'player') {
        legs.push({
          palette: statusPalette(e.status.kind),
          dest: { kind: 'player', slot: 'status' },
        })
      } else {
        legs.push({
          palette: statusPalette(e.status.kind),
          dest: { kind: 'enemy', enemyId: e.target, slot: 'status' },
        })
      }
    } else if (e.kind === 'healed' && e.amount > 0) {
      legs.push({
        palette: 'heal',
        dest: { kind: 'player', slot: 'hp' },
      })
    } else if (e.kind === 'damage-dealt' && e.source === 'player-attack') {
      legs.push({
        palette: 'attack',
        dest: { kind: 'enemy', enemyId: e.targetId, slot: 'hp' },
        staggerMs: attackStagger,
      })
      attackStagger += 70
    } else if (e.kind === 'block-gained' && e.amount > 0) {
      legs.push({
        palette: 'heal',
        dest: { kind: 'player', slot: 'block' },
      })
    }
  }

  return legs
}

function buildTrailEvent(
  spellId: PendingSpellId,
  events: readonly GameEvent[],
  beat: SpellVisualBeat,
): GameEvent | null {
  const legs = legsFromEffectEvents(events)
  if (legs.length === 0) return null
  return {
    kind: 'spell-effect-trail',
    spellId,
    legs,
    trailStartMs: beat.trailStartMs,
    arriveMs: beat.arriveMs,
  }
}

function tagEffectEvents(
  events: GameEvent[],
  beat: SpellVisualBeat,
  tagDamage: boolean,
): GameEvent[] {
  return events.map((e) => {
    if (e.kind === 'status-applied' && e.source?.kind === 'player') {
      return { ...e, spellVisual: beat }
    }
    if (e.kind === 'healed') {
      return { ...e, spellVisual: beat }
    }
    if (e.kind === 'status-expired' && e.target === 'player') {
      return { ...e, spellVisual: beat }
    }
    if (tagDamage && e.kind === 'damage-dealt' && e.source === 'player-attack') {
      return { ...e, spellVisual: beat }
    }
    if (e.kind === 'block-gained') {
      return { ...e, spellVisual: beat }
    }
    return e
  })
}

export function withImmediateSpellVisuals(
  spellId: SpellId,
  events: GameEvent[],
): GameEvent[] {
  const beat = immediateSpellBeat(spellId)
  const effectOnly = events.filter(
    (e) => e.kind !== 'spell-cast' && e.kind !== 'spell-effect-trail',
  )
  const trail = buildTrailEvent(spellId, effectOnly, beat)
  const tagged = tagEffectEvents(events, beat, false)
  if (!trail) return tagged
  const withoutDup = tagged.filter((e) => e.kind !== 'spell-effect-trail')
  return [trail, ...withoutDup]
}

export function withPendingSpellVisuals(
  spellId: PendingSpellId,
  events: GameEvent[],
): GameEvent[] {
  const beat = pendingSpellBeat(spellId)
  const trail = buildTrailEvent(spellId, events, beat)
  const tagged = tagEffectEvents(events, beat, true)
  if (!trail) return tagged
  return [trail, ...tagged.filter((e) => e.kind !== 'spell-effect-trail')]
}

export function readSpellVisualBeat(
  event: GameEvent,
): SpellVisualBeat | undefined {
  if ('spellVisual' in event && event.spellVisual) {
    return event.spellVisual
  }
  return undefined
}
