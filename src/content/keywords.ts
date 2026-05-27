import { getStatusDef } from './statuses'

export type KeywordId =
  | 'burn'
  | 'vulnerable'
  | 'weak'
  | 'regen'
  | 'strength'
  | 'hp'
  | 'heal'
  | 'mana'
  | 'wildMana'
  | 'ultimate'
  | 'block'
  | 'riposte'
  | 'bulwark'
  | 'reinforce'

export type KeywordDef = {
  id: KeywordId
  name: string
  icon: string
  body: string
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
  hp: {
    id: 'hp',
    name: 'HP',
    icon: '♥',
    body: 'Your health. At 0 in a fight, you lose. Carries between fights until you rest or take damage.',
    variant: 'hp',
  },
  heal: {
    id: 'heal',
    name: 'Heal',
    icon: '💚',
    body: 'Restores HP. Green gems heal as you match them; spells and effects can heal too.',
    variant: 'heal',
  },
  mana: {
    id: 'mana',
    name: 'Mana',
    icon: '◆',
    body: 'Fuel for casting spells. Filled by matching gems of the same colour. Clears between fights.',
    variant: 'mana',
  },
  wildMana: {
    id: 'wildMana',
    name: 'Wild mana',
    icon: '✦',
    body: 'From yellow gems only. When you cast a spell, covers missing colours one-for-one.',
    variant: 'wildMana',
  },
  ultimate: {
    id: 'ultimate',
    name: 'Ultimate',
    icon: '⚡',
    body: 'Built from purple gems. Spend the full bar to unleash your ultimate ability once.',
    variant: 'ultimate',
  },
  block: {
    id: 'block',
    name: 'Armor',
    icon: '🛡',
    body: 'Absorbs incoming damage before it hits HP. Built mostly from matching blue gems. Clears at the start of your next turn unless an effect carries it.',
    variant: 'block',
  },
  riposte: {
    id: 'riposte',
    name: 'Riposte',
    icon: '⚔',
    body: 'Parries the next enemy attack — you take 0, the attacker takes the full pre-armor amount back. Expires unused at end of enemy turn.',
    variant: 'riposte',
  },
  bulwark: {
    id: 'bulwark',
    name: 'Bulwark',
    icon: '🛡',
    body: 'Pending: at end of phase, your blue pool becomes an attack at half its value. Armor becomes 0.',
    variant: 'block',
  },
  reinforce: {
    id: 'reinforce',
    name: 'Reinforce',
    icon: '🛡',
    body: 'Pending: at end of phase, your blue pool doubles into armor, and that armor carries over the next phase.',
    variant: 'block',
  },
}

export function getKeyword(id: KeywordId): KeywordDef {
  return defs[id]
}
