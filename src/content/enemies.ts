import {
  registerArchetype,
  type ArchetypeDef,
} from '../core/combat/archetypeRegistry'
import { STATUS_TEMPLATES } from './statuses'

const brute: ArchetypeDef = {
  id: 'brute',
  name: 'Brute',
  maxHp: 20,
  pattern: ['attack', 'column-smash', 'attack', 'block', 'attack'],
  attackRange: { min: 3, max: 5 },
  blockRange: { min: 3, max: 5 },
}

const smolder: ArchetypeDef = {
  id: 'smolder',
  name: 'Smolder',
  maxHp: 18,
  pattern: ['attack', 'tile-burn', 'attack', 'attack'],
  attackRange: { min: 2, max: 4 },
  blockRange: { min: 0, max: 0 },
  tileBurnCount: 4,
  tileBurnDuration: 3,
  onHitStatus: { ...STATUS_TEMPLATES.burn },
}

const skirmisher: ArchetypeDef = {
  id: 'skirmisher',
  name: 'Skirmisher',
  maxHp: 11,
  pattern: ['attack'],
  attackRange: { min: 2, max: 3 },
  blockRange: { min: 0, max: 0 },
}

const rallier: ArchetypeDef = {
  id: 'rallier',
  name: 'Rallier',
  maxHp: 11,
  pattern: ['attack', 'buff-ally', 'attack'],
  attackRange: { min: 1, max: 2 },
  blockRange: { min: 0, max: 0 },
  buffAllyStacks: 2,
}

const defender: ArchetypeDef = {
  id: 'defender',
  name: 'Defender',
  maxHp: 22,
  pattern: ['block', 'petrify-row', 'attack', 'petrify-row'],
  attackRange: { min: 2, max: 3 },
  blockRange: { min: 3, max: 5 },
  petrifyDuration: 2,
}

const caster: ArchetypeDef = {
  id: 'caster',
  name: 'Caster',
  maxHp: 12,
  pattern: ['attack', 'color-hex'],
  attackRange: { min: 1, max: 2 },
  blockRange: { min: 0, max: 0 },
  onHitStatus: { kind: 'weak', stacks: 2 },
  colorHexDuration: 2,
  hexWeakStacksPerCell: 1,
}

const swarmer: ArchetypeDef = {
  id: 'swarmer',
  name: 'Swarmer',
  maxHp: 8,
  pattern: ['attack', 'cluster-shove'],
  attackRange: { min: 1, max: 2 },
  blockRange: { min: 0, max: 0 },
  clusterShoveLength: 2,
}

const tyrant: ArchetypeDef = {
  id: 'tyrant',
  name: 'Tyrant',
  maxHp: 48,
  pattern: [
    'attack',
    'column-smash',
    'attack',
    'petrify-row',
    'block',
    'attack',
    'column-smash',
    'attack',
  ],
  attackRange: { min: 6, max: 9 },
  blockRange: { min: 5, max: 8 },
  petrifyDuration: 2,
}

registerArchetype(brute)
registerArchetype(smolder)
registerArchetype(skirmisher)
registerArchetype(rallier)
registerArchetype(defender)
registerArchetype(caster)
registerArchetype(swarmer)
registerArchetype(tyrant)
