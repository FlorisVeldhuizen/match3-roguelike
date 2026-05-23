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
  manaCost: 3,
  description:
    'End of phase: consume blue pool, deal floor(blue / 2) to the targeted enemy. No block from blue this phase.',
}

const reinforce: SpellDef = {
  id: 'reinforce',
  name: 'Reinforce',
  icon: '🛡',
  manaCost: 4,
  description:
    "End of phase: doubles this phase's block on carry-over (decays normally next phase).",
}

const riposte: UltimateDef = {
  id: 'riposte',
  name: 'Riposte',
  icon: '⚡',
  chargeCost: 8,
  description:
    "Next enemy turn: if they attack, take 0 damage and counter for the full pre-block amount. If they don't attack, Riposte expires unused.",
}

registerSpell(bulwark)
registerSpell(reinforce)
registerUltimate(riposte)
