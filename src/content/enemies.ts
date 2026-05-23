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

// Bleeder: low HP, alternates attack-with-Burn-on-hit and the tile-burn
// board verb. Pattern from 04-roadmap (Phase F is its first instance);
// numbers in the early-mid band (HP 15-20, damage 2-4 — softer than
// Brute because the lasting Burn is the real threat).
const bleeder: ArchetypeDef = {
  id: 'bleeder',
  name: 'Bleeder',
  maxHp: 18,
  pattern: ['attack', 'tile-burn', 'attack', 'attack'],
  attackRange: { min: 2, max: 4 },
  blockRange: { min: 0, max: 0 },
  tileBurnCount: 2,
  // Linger 3 player phases. The original 2 made the verb feel like a
  // chore — players had one phase to clear or eat the burn, no room
  // for "decide later". 3 gives the player a real choice about whether
  // to burn a turn routing around a flagged cell.
  tileBurnDuration: 3,
  onHitStatus: { kind: 'burn', stacks: 1, duration: 3 },
}

// Side-effect registration: bootstrap imports this file once from main.tsx.
registerArchetype(brute)
registerArchetype(bleeder)
