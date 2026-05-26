// Keyword registry for the inline "keyword tooltip" pattern used in
// intent badges, spell tooltips, etc. A keyword is a mechanic the player
// might need a refresher on while reading another tooltip — Burn,
// Vulnerable, Riposte, etc. The <Keyword> component (ui/components)
// renders one inline, highlighted in its mechanic's palette, with a
// sub-tooltip on hover showing the definition.
//
// Status keywords (Burn / Vulnerable / Weak) deliberately read their
// name + icon from STATUS_TEMPLATES so the chip and the keyword stay in
// sync. Non-status keywords (future Block / Riposte / etc.) declare
// everything inline.

import { getStatusDef } from './statuses'

export type KeywordId =
  | 'burn'
  | 'vulnerable'
  | 'weak'
  | 'regen'
  | 'strength'
  | 'block'
  | 'riposte'
  | 'bulwark'
  | 'reinforce'

export type KeywordDef = {
  id: KeywordId
  name: string
  icon: string
  // Short body for the sub-tooltip. Keep to one short sentence — the
  // sub-tooltip pops on top of an already-open tooltip; a paragraph
  // crowds the screen. The longer "why does this exist" explanation
  // belongs in the design doc, not the keyword body.
  body: string
  // CSS variant key — `kw-${variant}` is added to the inline span. Used
  // for per-mechanic colours so Burn reads orange, Block reads blue, etc.
  variant: string
}

const defs: Record<KeywordId, KeywordDef> = {
  burn: {
    id: 'burn',
    name: getStatusDef('burn').name,
    icon: getStatusDef('burn').icon,
    body: 'Takes its current value as damage at the start of each turn, then weakens by 1.',
    variant: 'burn',
  },
  vulnerable: {
    id: 'vulnerable',
    name: getStatusDef('vulnerable').name,
    icon: getStatusDef('vulnerable').icon,
    body: 'Takes 50% extra damage from attacks. Decays by 1 each turn.',
    variant: 'vulnerable',
  },
  weak: {
    id: 'weak',
    name: getStatusDef('weak').name,
    icon: getStatusDef('weak').icon,
    body: 'Attacks deal 50% less damage. Decays by 1 each turn.',
    variant: 'weak',
  },
  regen: {
    id: 'regen',
    name: getStatusDef('regen').name,
    icon: getStatusDef('regen').icon,
    body: 'Heals its current value at the start of each turn, then weakens by 1.',
    variant: 'regen',
  },
  strength: {
    id: 'strength',
    name: getStatusDef('strength').name,
    icon: getStatusDef('strength').icon,
    body: 'Attacks deal extra damage equal to current stacks. Sticks until removed.',
    variant: 'strength',
  },
  block: {
    id: 'block',
    name: 'Block',
    icon: '🛡',
    body: 'Absorbs incoming damage before it hits HP. Zeroes at the start of your next turn unless carried.',
    variant: 'block',
  },
  riposte: {
    id: 'riposte',
    name: 'Riposte',
    icon: '⚔',
    body: 'Parries the next enemy attack — you take 0, the attacker takes the full pre-block amount back. Expires unused at end of enemy turn.',
    variant: 'riposte',
  },
  bulwark: {
    id: 'bulwark',
    name: 'Bulwark',
    icon: '🛡',
    body: 'Pending: at end of phase, your blue pool becomes an attack at half its value. Block becomes 0.',
    variant: 'block',
  },
  reinforce: {
    id: 'reinforce',
    name: 'Reinforce',
    icon: '🛡',
    body: 'Pending: at end of phase, your blue pool doubles into block, and that block carries over the next phase.',
    variant: 'block',
  },
}

export function getKeyword(id: KeywordId): KeywordDef {
  return defs[id]
}
