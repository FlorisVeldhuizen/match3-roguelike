import { registerRelic } from '../core/relics/registry'
import type { RelicDef } from '../core/relics/types'

// Phase G relics. Five hooks exercised: onMatch (Iron Buckler, Sharp Edge,
// Cascade Crystal), onDamageTaken (Thornmail), onFatalDamage (Stoneheart).
// The remaining 10 hooks are wired in the engine but unused by these five —
// J2 picks them up.

const ironBuckler: RelicDef = {
  id: 'iron-buckler',
  name: 'Iron Buckler',
  rarity: 'common',
  icon: '🛡',
  description: 'Each blue match grants +1 block at end of phase.',
  upgradable: true,
  upgradedDescription: 'Each blue match grants +2 block at end of phase.',
  hooks: {
    onMatch: (payload, ctx) => {
      if (payload.match.color !== 'blue') return payload
      const bonus = ctx.upgraded ? 2 : 1
      return {
        ...payload,
        deltas: { ...payload.deltas, blue: payload.deltas.blue + bonus },
      }
    },
  },
}

const sharpEdge: RelicDef = {
  id: 'sharp-edge',
  name: 'Sharp Edge',
  rarity: 'common',
  icon: '⚔',
  description: 'Each red match deals +1 damage.',
  upgradable: true,
  upgradedDescription: 'Each red match deals +2 damage.',
  hooks: {
    onMatch: (payload, ctx) => {
      if (payload.match.color !== 'red') return payload
      const bonus = ctx.upgraded ? 2 : 1
      return {
        ...payload,
        deltas: { ...payload.deltas, red: payload.deltas.red + bonus },
      }
    },
  },
}

const thornmail: RelicDef = {
  id: 'thornmail',
  name: 'Thornmail',
  rarity: 'common',
  icon: '🌵',
  description: 'When an enemy attacks you, reflect 1 damage back.',
  upgradable: true,
  upgradedDescription: 'When an enemy attacks you, reflect 2 damage back.',
  hooks: {
    onDamageTaken: (payload, ctx) => {
      // Only enemy attacks trigger thornmail — burn, self-curse (J1),
      // and other sources are explicitly excluded per architecture §2.
      if (payload.source !== 'enemy-attack') return
      if (payload.attackerId == null) return
      const reflect = ctx.upgraded ? 2 : 1
      ctx.emit({
        kind: 'relic-triggered',
        relicId: 'thornmail',
        effect: `reflected ${reflect} damage`,
      })
      // The store walker scans engine-emitted damage-dealt events with
      // source='thornmail' and applies them to the attacker. Engine only
      // produces the description; resolution lives at the call site.
      ctx.emit({
        kind: 'damage-dealt',
        targetId: payload.attackerId,
        amount: reflect,
        blocked: 0,
        source: 'thornmail',
      })
    },
  },
}

const cascadeCrystal: RelicDef = {
  id: 'cascade-crystal',
  name: 'Cascade Crystal',
  rarity: 'uncommon',
  icon: '💎',
  description:
    'Cascade chains amplify pools by ×1.5 (applied after additive bonuses).',
  orderHint: 'multipliers apply after +N relics in acquisition order',
  hooks: {
    onMatch: (payload) => {
      if (payload.cascadeLevel < 1) return payload
      const mult = 1.5
      return {
        ...payload,
        deltas: {
          red: Math.floor(payload.deltas.red * mult),
          blue: Math.floor(payload.deltas.blue * mult),
          green: Math.floor(payload.deltas.green * mult),
          yellow: Math.floor(payload.deltas.yellow * mult),
          purple: Math.floor(payload.deltas.purple * mult),
          // Phase I: cascade amplification applies to gold too — same
          // tempo, same multiplier rule. Future gold-specific relics
          // could opt out by mutating deltas.gold separately.
          gold: Math.floor(payload.deltas.gold * mult),
        },
      }
    },
  },
}

const stoneheart: RelicDef = {
  id: 'stoneheart',
  name: 'Stoneheart',
  rarity: 'rare',
  icon: '💖',
  description: 'The first lethal blow this run leaves you at 1 HP instead.',
  hooks: {
    onFatalDamage: (_payload, ctx) => {
      if (ctx.getRunFlag('triggered') === true) return null
      ctx.setRunFlag('triggered', true)
      ctx.emit({
        kind: 'relic-triggered',
        relicId: 'stoneheart',
        effect: 'saved you at 1 HP',
      })
      return { prevented: true, hpFloor: 1, relicId: 'stoneheart' }
    },
  },
}

registerRelic(ironBuckler)
registerRelic(sharpEdge)
registerRelic(thornmail)
registerRelic(cascadeCrystal)
registerRelic(stoneheart)
