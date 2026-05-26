import {
  registerArchetype,
  type ArchetypeDef,
} from '../core/combat/archetypeRegistry'
import { STATUS_TEMPLATES } from './statuses'

// Brute: high HP, big attack, periodic column-smash board verb.
// H2b pattern adds column-smash to the original Brute cycle so the
// Brute "shares the board" the way the design doc requires. Single
// telegraph → fire cycle: smash announces this phase, fires next.
// columnSmashDuration defaults to 1 (standard single-phase warning).
const brute: ArchetypeDef = {
  id: 'brute',
  name: 'Brute',
  maxHp: 20,
  pattern: ['attack', 'column-smash', 'attack', 'block', 'attack'],
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

// Defender: H2b wall-archetype. High HP, persistent block accumulation,
// no attack rider — the actual threat is the petrify-row board verb,
// fired twice per pattern cycle. Player has to grind through the
// accumulating block while routing matches around locked rows.
// Pattern alternates block → petrify → small attack → petrify so the
// player gets a brief "breather" before the next lockout, but the
// block keeps stacking and the lockouts come fast.
// Stats: HP 22 (heavier than Brute's 20 — Defender is meant to feel
// like a wall to grind down), attack 2-3 (minimal direct damage —
// the petrify is the threat), block 3-5.
// petrifyDuration 2 = locked phase + the next phase, decremented at
// phase start. Per design doc: long enough to force routing, short
// enough not to grind the fight to a halt.
const defender: ArchetypeDef = {
  id: 'defender',
  name: 'Defender',
  maxHp: 22,
  pattern: ['block', 'petrify-row', 'attack', 'petrify-row'],
  attackRange: { min: 2, max: 3 },
  blockRange: { min: 3, max: 5 },
  petrifyDuration: 2,
}

// Caster: H2c fragile debuff specialist. Low HP, no block — the danger
// is the colour-hex board verb (a 2-phase trap on a chosen colour) plus
// a Weak-rider attack between hexes. Pattern starts with `attack` so
// the player gets a normal first telegraph; the hex telegraph appears
// from turn 2 onward. Stats: HP 12 (below Skirmisher's 11 would feel
// trivial; 12 keeps the kill realistic against a fresh red pool but
// still firmly fragile), attack 1-2 (debuff is the real cost), no block.
const caster: ArchetypeDef = {
  id: 'caster',
  name: 'Caster',
  maxHp: 12,
  pattern: ['attack', 'color-hex'],
  attackRange: { min: 1, max: 2 },
  blockRange: { min: 0, max: 0 },
  // Weak on hit pairs with the hex — both apply Weak from different
  // angles (attack reliably, hex by tempting the player to keep matching).
  onHitStatus: { kind: 'weak', stacks: 2 },
  // 2 enemy-phases active matches Defender's petrifyDuration cadence.
  // Long enough to force routing, short enough not to grind the fight.
  colorHexDuration: 2,
  hexWeakStacksPerCell: 1,
}

// Swarmer: H2c group-spawning disruption archetype. Very low HP (8 —
// dies to most single matches), low attack (1-2), no block. Spawns in
// groups of 2-3 per map node so the cluster-shove pressure compounds.
// Pattern alternates attack and cluster-shove for a steady disruption
// drumbeat. clusterShoveLength stays at the default 2 — heavier runs
// would overshadow Defender's row lockout and break the verb gradient.
const swarmer: ArchetypeDef = {
  id: 'swarmer',
  name: 'Swarmer',
  maxHp: 8,
  pattern: ['attack', 'cluster-shove'],
  attackRange: { min: 1, max: 2 },
  blockRange: { min: 0, max: 0 },
  clusterShoveLength: 2,
}

// Side-effect registration: bootstrap imports this file once from main.tsx.
registerArchetype(brute)
registerArchetype(smolder)
registerArchetype(skirmisher)
registerArchetype(rallier)
registerArchetype(defender)
registerArchetype(caster)
registerArchetype(swarmer)
