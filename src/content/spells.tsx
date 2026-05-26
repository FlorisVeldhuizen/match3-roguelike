import {
  registerSpell,
  registerUltimate,
  type SpellDef,
  type UltimateDef,
} from '../core/combat/spellRegistry'
import { Keyword } from '../ui/components/Keyword'

// Knight kit (H4a redesign). Costs from 02-scope §Difficulty curve.
// Effects from 01-design §Abilities. Numeric resolution:
//   - core/combat/turn.ts: Bulwark/Reinforce/Volley at EOP
//   - core/combat/enemyTurn.ts: Riposte counter on incoming attack
//   - core/combat/spellResolvers.ts: immediate-effect spells (Ignite,
//     Regenerate, Purify, Brittle, Cinder Lash, Focus)
//   - core/state/store.ts: Skewer/Surge flag arming + cascade-walker
//     consumption

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

// H4a player-distributed AOE. At cast time, the player picks three
// enemy targets (one per hit, can repeat) in a modal. While Volley is
// queued, red matches stop dealing damage and pool up; at EOP the
// pool splits into 3 chunks (floor(pool/3); remainder lands on the
// last chunk) and each chunk hits its assigned target.
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

// H4a immediate mana conversion. Player picks a source colour (with
// ≥1 mana) and a target colour (with cap headroom); spell moves up to
// 3 mana from source → target. Yellow cost is explicit — Focus can't
// fund itself via the wild-substitution rule.
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

// --- H4a redesign — replacing Bash / Steel Heart / Cleanse ---

// Ignite: weaponize the burn track. Apply 3 Burn to the current target.
// Threads with Smolder and future burn-relics. Auto-targets the
// selected enemy (consistent with red-match damage routing).
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

// Regenerate: player-side mirror of Burn. Apply 3 Regen to self →
// heals 3, 2, 1 at the start of your next three turns (6 HP total,
// front-loaded). Spreading the heal creates a tempo-investment decision
// vs. an instant green-match heal.
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

// Purify: remove a status entirely (all stacks). Burn-specific kicker:
// also heal 3 HP. Encourages the "tank the burn, then cleanse it for
// HP" line. Picker UI shows player's current statuses.
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

// --- H4a redesign — new spells ---

// Skewer: one-shot setup. Your next match's red damage is doubled.
// Pending so it shows in the strip until consumed. Cleared by the
// match walker when the next match fires (not at EOP).
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

// Brittle: status-setup play. Apply 2 Vulnerable to the current target.
// Pairs with big red matches the same turn — Vulnerable composes
// through the existing damage pipeline. Auto-targets selected enemy.
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

// Surge: cascade play. Your next match counts as cascade level +2.
// Activates Cascade Crystal (and future cascade-relics) on a match
// that would normally be level 0. Pending so it shows in the strip;
// consumed by the match walker.
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

// Cinder Lash: hybrid offence + sustain. Apply 2 Burn to target +
// heal 2 self. First multi-cost spell — costs 2 red AND 1 green.
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

// H2b.5: Shatter Color — first player-side board verb. Picker spell
// (player selects target color at cast time). Clears every gem of the
// chosen colour and applies the standard per-colour effect (red →
// damage, blue → block pool, green → heal, yellow → mana, purple →
// skill charge), scaled by cell count. Heavy yellow cost forces the
// player to bank wild mana before cashing in. Routes through the
// shared cascade walker, so relic onMatch / onCascade hooks (Sharp
// Edge, Iron Buckler, Cascade Crystal, …) fire on the cleared cells
// and any gravity-induced follow-up matches chain naturally.
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
