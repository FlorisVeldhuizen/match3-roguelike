import { registerRelic } from '../core/relics/registry'
import type { RelicDef } from '../core/relics/types'

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
      if (payload.source !== 'enemy-attack') return
      if (payload.attackerId == null) return
      const reflect = ctx.upgraded ? 2 : 1
      ctx.emit({
        kind: 'relic-triggered',
        relicId: 'thornmail',
        effect: `reflected ${reflect} damage`,
      })
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

const harvester: RelicDef = {
  id: 'harvester',
  name: 'Harvester',
  rarity: 'uncommon',
  icon: '🪓',
  description: 'When an enemy dies, deal 2 damage to a random other living enemy.',
  upgradable: true,
  upgradedDescription:
    'When an enemy dies, deal 3 damage to a random other living enemy.',
  hooks: {
    onEnemyKilled: (event, ctx) => {
      const others = ctx.state.enemies.filter(
        (e) => e.hp > 0 && e.id !== event.enemyId,
      )
      if (others.length === 0) return
      const target = others[Math.floor(Math.random() * others.length)]
      const dmg = ctx.upgraded ? 3 : 2
      ctx.emit({
        kind: 'relic-triggered',
        relicId: 'harvester',
        effect: `dealt ${dmg} damage to ${target.name}`,
      })
      ctx.emit({
        kind: 'damage-dealt',
        targetId: target.id,
        amount: dmg,
        blocked: 0,
        source: 'relic-effect',
      })
    },
  },
}

const morningStar: RelicDef = {
  id: 'morning-star',
  name: 'Morning Star',
  rarity: 'common',
  icon: '🌟',
  description: 'At player phase start, gain 3 block if you have none.',
  upgradable: true,
  upgradedDescription: 'At player phase start, gain 5 block if you have none.',
  hooks: {
    onPhaseStart: (event, ctx) => {
      if (event.phaseKind !== 'player') return
      if (ctx.state.player.block !== 0) return
      const amount = ctx.upgraded ? 5 : 3
      ctx.emit({
        kind: 'relic-triggered',
        relicId: 'morning-star',
        effect: `gained ${amount} block`,
      })
      ctx.emit({ kind: 'block-gained', amount })
    },
  },
}

const afterburner: RelicDef = {
  id: 'afterburner',
  name: 'Afterburner',
  rarity: 'uncommon',
  icon: '🔥',
  description:
    'At player phase end, deal damage equal to half your unspent red pool.',
  upgradable: true,
  upgradedDescription:
    'At player phase end, deal damage equal to your full unspent red pool.',
  hooks: {
    onPhaseEnd: (event, ctx) => {
      if (event.phaseKind !== 'player') return
      const red = ctx.state.player.phasePools.red
      if (red <= 0) return
      const dmg = ctx.upgraded ? red : Math.floor(red / 2)
      if (dmg <= 0) return
      const targetId =
        ctx.state.targetEnemyId ??
        ctx.state.enemies.find((e) => e.hp > 0)?.id
      if (targetId == null) return
      ctx.emit({
        kind: 'relic-triggered',
        relicId: 'afterburner',
        effect: `burned ${dmg} damage from leftover red`,
      })
      ctx.emit({
        kind: 'damage-dealt',
        targetId,
        amount: dmg,
        blocked: 0,
        source: 'relic-effect',
      })
    },
  },
}

const avalanche: RelicDef = {
  id: 'avalanche',
  name: 'Avalanche',
  rarity: 'uncommon',
  icon: '🏔',
  description: 'Cascades of 2+ deal 1 damage to all enemies.',
  upgradable: true,
  upgradedDescription: 'Cascades of 2+ deal 2 damage to all enemies.',
  hooks: {
    onCascade: (event, ctx) => {
      if (event.level < 2) return
      const dmg = ctx.upgraded ? 2 : 1
      const living = ctx.state.enemies.filter((e) => e.hp > 0)
      if (living.length === 0) return
      ctx.emit({
        kind: 'relic-triggered',
        relicId: 'avalanche',
        effect: `dealt ${dmg} damage to all enemies`,
      })
      for (const enemy of living) {
        ctx.emit({
          kind: 'damage-dealt',
          targetId: enemy.id,
          amount: dmg,
          blocked: 0,
          source: 'relic-effect',
        })
      }
    },
  },
}

const fortified: RelicDef = {
  id: 'fortified',
  name: 'Fortified',
  rarity: 'common',
  icon: '🧱',
  description: 'When you gain block, gain 1 additional block (once per phase).',
  upgradable: true,
  upgradedDescription:
    'When you gain block, gain 2 additional block (once per phase).',
  hooks: {
    onBlockGained: (event, ctx) => {
      if (event.target !== 'player') return
      if (ctx.getFightFlag('fired-this-phase')) return
      ctx.setFightFlag('fired-this-phase', true)
      const bonus = ctx.upgraded ? 2 : 1
      ctx.emit({
        kind: 'relic-triggered',
        relicId: 'fortified',
        effect: `+${bonus} block`,
      })
      ctx.emit({ kind: 'block-gained', amount: bonus })
    },
  },
}

const spite: RelicDef = {
  id: 'spite',
  name: 'Spite',
  rarity: 'uncommon',
  icon: '😈',
  description:
    'When your block is broken, apply 2 Vulnerable to the targeted enemy.',
  upgradable: true,
  upgradedDescription:
    'When your block is broken, apply 3 Vulnerable to the targeted enemy.',
  hooks: {
    onBlockBroken: (event, ctx) => {
      if (event.target !== 'player') return
      const targetId = ctx.state.targetEnemyId
      if (targetId == null) return
      const stacks = ctx.upgraded ? 3 : 2
      ctx.emit({
        kind: 'relic-triggered',
        relicId: 'spite',
        effect: `applied ${stacks} Vulnerable`,
      })
      ctx.emit({
        kind: 'status-applied',
        target: targetId,
        status: { kind: 'vulnerable', stacks },
        source: { kind: 'player' },
      })
    },
  },
}

const overcharge: RelicDef = {
  id: 'overcharge',
  name: 'Overcharge',
  rarity: 'rare',
  icon: '⚡',
  description: 'When you use your ultimate, apply 2 Burn to all enemies.',
  upgradable: true,
  upgradedDescription:
    'When you use your ultimate, apply 3 Burn to all enemies.',
  hooks: {
    onUltimateUsed: (_event, ctx) => {
      const stacks = ctx.upgraded ? 3 : 2
      const living = ctx.state.enemies.filter((e) => e.hp > 0)
      if (living.length === 0) return
      ctx.emit({
        kind: 'relic-triggered',
        relicId: 'overcharge',
        effect: `applied ${stacks} Burn to all enemies`,
      })
      for (const enemy of living) {
        ctx.emit({
          kind: 'status-applied',
          target: enemy.id,
          status: { kind: 'burn', stacks },
          source: { kind: 'player' },
        })
      }
    },
  },
}

const warDrum: RelicDef = {
  id: 'war-drum',
  name: 'War Drum',
  rarity: 'uncommon',
  icon: '🥁',
  description: 'At fight start, gain 2 Strength.',
  upgradable: true,
  upgradedDescription: 'At fight start, gain 3 Strength.',
  hooks: {
    onRoundStarted: (_event, ctx) => {
      const stacks = ctx.upgraded ? 3 : 2
      ctx.emit({
        kind: 'relic-triggered',
        relicId: 'war-drum',
        effect: `gained ${stacks} Strength`,
      })
      ctx.emit({
        kind: 'status-applied',
        target: 'player',
        status: { kind: 'strength', stacks },
        source: { kind: 'player' },
      })
    },
  },
}

const collectorsEye: RelicDef = {
  id: 'collectors-eye',
  name: "Collector's Eye",
  rarity: 'common',
  icon: '👁',
  description: 'When you gain a relic, heal 5 HP.',
  upgradable: true,
  upgradedDescription: 'When you gain a relic, heal 8 HP.',
  hooks: {
    onRelicGained: (_event, ctx) => {
      const amount = ctx.upgraded ? 8 : 5
      ctx.emit({
        kind: 'relic-triggered',
        relicId: 'collectors-eye',
        effect: `healed ${amount} HP`,
      })
      ctx.emit({ kind: 'healed', amount })
    },
  },
}

const battleCry: RelicDef = {
  id: 'battle-cry',
  name: 'Battle Cry',
  rarity: 'common',
  icon: '📯',
  description: 'When you cast a spell, deal 1 damage to the targeted enemy.',
  upgradable: true,
  upgradedDescription:
    'When you cast a spell, deal 2 damage to the targeted enemy.',
  hooks: {
    onSpellCast: (_event, ctx) => {
      const targetId = ctx.state.targetEnemyId
      if (targetId == null) return
      const dmg = ctx.upgraded ? 2 : 1
      ctx.emit({
        kind: 'relic-triggered',
        relicId: 'battle-cry',
        effect: `dealt ${dmg} damage`,
      })
      ctx.emit({
        kind: 'damage-dealt',
        targetId,
        amount: dmg,
        blocked: 0,
        source: 'relic-effect',
      })
    },
  },
}

registerRelic(ironBuckler)
registerRelic(sharpEdge)
registerRelic(thornmail)
registerRelic(cascadeCrystal)
registerRelic(stoneheart)
registerRelic(harvester)
registerRelic(morningStar)
registerRelic(afterburner)
registerRelic(avalanche)
registerRelic(fortified)
registerRelic(spite)
registerRelic(overcharge)
registerRelic(warDrum)
registerRelic(collectorsEye)
registerRelic(battleCry)
