import {
  registerArchetype,
  type ArchetypeDef,
} from '../core/combat/archetypeRegistry'
import { STATUS_TEMPLATES } from './statuses'

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

// Smolder: low HP, alternates attack-with-Burn-on-hit and the tile-burn
// board verb. Pattern from 04-roadmap (Phase F is its first instance);
// numbers in the early-mid band (HP 15-20, damage 2-4 — softer than
// Brute because the lasting Burn is the real threat).
const smolder: ArchetypeDef = {
  id: 'smolder',
  name: 'Smolder',
  maxHp: 18,
  pattern: ['attack', 'tile-burn', 'attack', 'attack'],
  attackRange: { min: 2, max: 4 },
  blockRange: { min: 0, max: 0 },
  tileBurnCount: 4,
  // Linger 3 player phases. The original 2 made the verb feel like a
  // chore — players had one phase to clear or eat the burn, no room
  // for "decide later". 3 gives the player a real choice about whether
  // to burn a turn routing around a flagged cell.
  tileBurnDuration: 3,
  // Reuse the canonical Burn shape from STATUS_TEMPLATES — single
  // source of truth for "what does a fresh Burn look like". Same
  // shape, same field names.
  onHitStatus: { ...STATUS_TEMPLATES.burn },
}

// Skirmisher: H2a connective-tissue archetype — low HP, attacks every
// turn for a small bite, no board verb (02-scope §Enemies "pure stat /
// keeps the early curve gentle"). Length-1 pattern means every turn
// rolls an attack, no block phase. Stats fit the early-tier band
// (HP 10-12 → softer than Brute's 20; damage 2-3 → meaningful chip
// damage when stacked with a Brute or Smolder).
const skirmisher: ArchetypeDef = {
  id: 'skirmisher',
  name: 'Skirmisher',
  maxHp: 11,
  pattern: ['attack'],
  attackRange: { min: 2, max: 3 },
  blockRange: { min: 0, max: 0 },
}

// Rallier: H4b support archetype. Low HP + attack, but cycles through
// buff-ally → attack → attack to strengthen its companions over time.
// New archetype (not mutating Skirmisher) to keep H2a balance intact.
// Stats: HP 10-12 (same soft band as Skirmisher), attack 1-2 (minimal
// threat solo — the danger is what it does to its allies).
const rallier: ArchetypeDef = {
  id: 'rallier',
  name: 'Rallier',
  maxHp: 11,
  pattern: ['attack', 'buff-ally', 'attack'],
  attackRange: { min: 1, max: 2 },
  blockRange: { min: 0, max: 0 },
  // buff-ally applies 2 Strength stacks per cast (matches STATUS_TEMPLATES default).
  buffAllyStacks: 2,
}

// Side-effect registration: bootstrap imports this file once from main.tsx.
registerArchetype(brute)
registerArchetype(smolder)
registerArchetype(skirmisher)
registerArchetype(rallier)
