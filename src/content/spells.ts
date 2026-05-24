import {
  registerSpell,
  registerUltimate,
  type SpellDef,
  type UltimateDef,
} from '../core/combat/spellRegistry'

// Knight kit — costs from 02-scope §Difficulty curve. Effects from
// 01-design §Abilities. Numeric resolution lives in core/combat/turn.ts
// (Bulwark/Reinforce at EOP) and core/combat/enemyTurn.ts (Riposte
// counter on incoming attack).

const bulwark: SpellDef = {
  id: 'bulwark',
  name: 'Bulwark',
  icon: '🗡',
  cost: { blue: 3 },
  description:
    "When your turn ends, your armor strikes the enemy for half its value. You'll have no armor this turn.",
  pendingLabel: 'queued',
  pendingDescription:
    "When your turn ends, your armor strikes the enemy for half its value, then drops to zero.",
}

const reinforce: SpellDef = {
  id: 'reinforce',
  name: 'Reinforce',
  icon: '🛡',
  cost: { blue: 4 },
  description:
    "Doubles your armor when your turn ends and carries it over into next turn instead of letting it evaporate.",
  pendingLabel: 'queued',
  pendingDescription:
    'When your turn ends, your armor is doubled and survives into next turn.',
}

const riposte: UltimateDef = {
  id: 'riposte',
  name: 'Riposte',
  icon: '⚡',
  chargeCost: 8,
  description:
    "Parry the next enemy attack. Take no damage and hit them back for the full amount. If they don't swing, the parry is wasted.",
  pendingLabel: 'armed',
  pendingDescription:
    "Next enemy attack hits you for 0 and bounces back at full strength.",
}

registerSpell(bulwark)
registerSpell(reinforce)
registerUltimate(riposte)
