import {
  registerSpell,
  registerUltimate,
  type SpellDef,
  type UltimateDef,
} from '../core/combat/spellRegistry'
import { Keyword } from '../ui/components/Keyword'

const bulwark: SpellDef = {
  id: 'bulwark',
  name: 'Bulwark',
  icon: '🗡',
  cost: { blue: 3 },
  resolution: 'pending',
  description: (
    <>
      When your turn ends, your <Keyword id="block">armor</Keyword> strikes the
      enemy for half its value. You'll have no armor this turn.
    </>
  ),
  pendingLabel: 'queued',
  pendingDescription: (
    <>
      When your turn ends, your <Keyword id="block">armor</Keyword> strikes the
      enemy for half its value, then drops to zero.
    </>
  ),
  starter: true,
}

const reinforce: SpellDef = {
  id: 'reinforce',
  name: 'Reinforce',
  icon: '🛡',
  cost: { blue: 4 },
  resolution: 'pending',
  description: (
    <>
      Doubles your <Keyword id="block">armor</Keyword> when your turn ends and
      carries it over into next turn instead of letting it evaporate.
    </>
  ),
  pendingLabel: 'queued',
  pendingDescription: (
    <>
      When your turn ends, your <Keyword id="block">armor</Keyword> is doubled
      and survives into next turn.
    </>
  ),
  starter: true,
}

const volley: SpellDef = {
  id: 'volley',
  name: 'Volley',
  icon: '🏹',
  cost: { red: 4 },
  resolution: 'pending',
  description:
    "Pick three targets when you cast it. Red matches feed a single pool, then split into three strikes when your turn ends — one per chosen target.",
  pendingLabel: 'loaded',
  pendingDescription:
    "When your turn ends, the red pool splits into three strikes, one per chosen target.",
}

const focus: SpellDef = {
  id: 'focus',
  name: 'Focus',
  icon: '🔮',
  cost: { yellow: 2 },
  resolution: 'immediate',
  description:
    "Trade up to 3 mana of one color for the same amount of another. Pick the swap when you cast it.",
  pendingLabel: '',
  pendingDescription: '',
}

const ignite: SpellDef = {
  id: 'ignite',
  name: 'Ignite',
  icon: '🔥',
  cost: { red: 3 },
  resolution: 'immediate',
  description: (
    <>
      Apply 3 <Keyword id="burn" /> to your target.
    </>
  ),
  pendingLabel: '',
  pendingDescription: '',
  starter: true,
}

const regenerate: SpellDef = {
  id: 'regenerate',
  name: 'Regenerate',
  icon: '🌿',
  cost: { green: 3 },
  resolution: 'immediate',
  description: (
    <>
      Apply 3 <Keyword id="regen" /> to yourself. Stacks if cast again.
    </>
  ),
  pendingLabel: '',
  pendingDescription: '',
}

const purify: SpellDef = {
  id: 'purify',
  name: 'Purify',
  icon: '✨',
  cost: { green: 2 },
  resolution: 'immediate',
  description: (
    <>
      Strip a curse off you entirely. If you cleared a <Keyword id="burn" />,
      recover 3 HP.
    </>
  ),
  pendingLabel: '',
  pendingDescription: '',
}

const skewer: SpellDef = {
  id: 'skewer',
  name: 'Skewer',
  icon: '🗡️',
  cost: { red: 2 },
  resolution: 'pending',
  description:
    "Charge your next strike. The damage from your next red match is doubled.",
  pendingLabel: 'armed',
  pendingDescription: 'Your next red match deals double damage.',
}

const brittle: SpellDef = {
  id: 'brittle',
  name: 'Brittle',
  icon: '🩸',
  cost: { blue: 3 },
  resolution: 'immediate',
  description: (
    <>
      Apply 2 <Keyword id="vulnerable" /> to your target.
    </>
  ),
  pendingLabel: '',
  pendingDescription: '',
}

const surge: SpellDef = {
  id: 'surge',
  name: 'Surge',
  icon: '⚡',
  cost: { yellow: 3 },
  resolution: 'pending',
  description:
    "Crackle the next match with stored energy — it counts as if it were two cascades deep.",
  pendingLabel: 'crackling',
  pendingDescription:
    'Your next match counts as cascade level +2 (triggers cascade relics).',
}

const cinderLash: SpellDef = {
  id: 'cinder-lash',
  name: 'Cinder Lash',
  icon: '🧪',
  cost: { red: 2, green: 1 },
  resolution: 'immediate',
  description: (
    <>
      Apply 2 <Keyword id="burn" /> to your target and recover 2 HP.
    </>
  ),
  pendingLabel: '',
  pendingDescription: '',
}

const shatter: SpellDef = {
  id: 'shatter',
  name: 'Shatter',
  icon: '💎',
  cost: { yellow: 4 },
  resolution: 'immediate',
  description:
    'Pick a gem on the board. Every gem of that colour shatters, paying out its usual effect (damage, block, heal, mana, or charge) scaled by how many cleared.',
  pendingLabel: '',
  pendingDescription: '',
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
registerSpell(volley)
registerSpell(focus)
registerSpell(ignite)
registerSpell(regenerate)
registerSpell(purify)
registerSpell(skewer)
registerSpell(brittle)
registerSpell(surge)
registerSpell(cinderLash)
registerSpell(shatter)
registerUltimate(riposte)
