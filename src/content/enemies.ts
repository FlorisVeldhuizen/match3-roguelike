import {
  registerArchetype,
  type ArchetypeDef,
} from '../core/combat/archetypeRegistry'

// Brute: high HP, big attack every 2-3 turns, blocks once per cycle.
// Pattern from 01-design §3 (⚔, ⚔, 🛡, ⚔, …). HP/damage from 02-scope
// early-tier band (HP 10-20, damage 3-5).
const brute: ArchetypeDef = {
  id: 'brute',
  name: 'Brute',
  maxHp: 20,
  pattern: ['attack', 'attack', 'block', 'attack'],
  attackRange: { min: 3, max: 5 },
  blockRange: { min: 3, max: 5 },
}

// Side-effect registration: bootstrap imports this file once from main.tsx.
registerArchetype(brute)
