# Shipped content catalog

**Status:** reflects codebase as of **2026-05-27** (mechanics expansion merged to `main`).

This doc is the **behavioral roster** for what players can encounter. Numeric tuning lives in `src/content/` — when numbers drift, trust the content files, not this table.

---

## How to read this doc

| Column | Meaning |
|--------|---------|
| **Intent pattern** | Fixed per-archetype script; only values and board targets roll from RNG |
| **Enrage** | At ≤50% HP (`enrageThreshold` on archetype), pattern resets and switches to `enragePattern` once |
| **Discoverable** | Earned via post-fight reward or shop, not in the Knight starter kit |

---

## Enemy archetypes (10 + boss)

| ID | Role | Board verb / hook | Pattern (normal) | Enrage (≤50% HP) |
|----|------|-------------------|------------------|------------------|
| **skirmisher** | Connective tissue | — | attack only | — |
| **brute** | Tank + smash | Column smash | attack, smash, attack, block, attack | More smashes, no block |
| **smolder** | Burn threat | Tile burn + Burn on hit | attack, burn, attack, attack | Faster burn cycle |
| **rallier** | Ally support | buff-ally (Strength) | attack, buff, attack | — |
| **defender** | Wall | Petrify row | block, petrify, attack, petrify | block, petrify, attack, attack |
| **caster** | Hex trap | Color hex → Weak on match | attack, hex | — |
| **swarmer** | Board shuffle | Cluster shove (2-cell run) | attack, shove | — |
| **leech** | Punish color | **Color drain** — matching drained color heals Leech | attack, drain, attack, attack | — |
| **shade** | Burst + sustain | **Lifesteal** — heals 50% of HP damage dealt | attack ×3 | — |
| **trickster** | Mind games | **Trick** — telegraphs `???`, resolves attack or block | attack, trick, attack, trick, block | — |
| **tyrant** (boss) | Kitchen-sink boss | smash + petrify + tile burn | 8-step mixed cycle | Adds tile-burn, faster aggression |

**Map placement:** Leech, Shade, and Trickster appear from mid columns onward; see `src/core/map/generate.ts` weights and mixed compositions.

**New intent kinds (mechanics expansion):**

- `color-drain` — like hex, but matching the drained color heals the draining enemy (per gem matched).
- `trick` — rolled inner intent is hidden until fire; emits `trick-swapped` for FX.

---

## Spells (15 + 1 ultimate)

### Starters (Knight kit)

| ID | Cost | Timing | Effect |
|----|------|--------|--------|
| bulwark | 3 blue | End of phase | Consume blue pool → attack at `floor(blue/2)`; no block from blue |
| reinforce | 4 blue | End of phase | Double block, carry to next phase |
| ignite | 3 red | Immediate | 3 Burn on target |

### Discoverable pool

| ID | Cost | Timing | Effect |
|----|------|--------|--------|
| volley | 4 red | End of phase | Pick 3 targets; red pool splits 3 ways at EOP |
| focus | 2 yellow | Immediate | Move up to 3 mana between colors |
| regenerate | 3 green | Immediate | Regen (see statuses) |
| purify | 2 green | Immediate | Remove one player debuff (picker) |
| skewer | 2 red | Next match | Double red damage once |
| brittle | 3 blue | Immediate | Vulnerable on target |
| surge | 3 yellow | Next match | +2 effective cascade level once |
| cinder-lash | 2 red + 1 green | Immediate | Burn spread variant |
| shatter | 4 yellow | Immediate | Pick color → all gems of that color shatter + cascade |
| **transmute** | 3 yellow | Immediate | Pick two colors → recolor board + cascade |
| **blessed-ground** | 3 green | Immediate | Bless 4 random cells (2× payout when matched through) |
| **frozen-wall** | 3 blue | Immediate | Petrify chosen row ~1 turn (player-side) |
| **chain-lightning** | 3 red | Next red match | That match damages **all** enemies (AOE) |

| riposte | 8 purple charge | Next enemy turn | Parry one attack, full counter |

Player board targeting: **shatter** (pick gem color), **frozen-wall** (pick row). **transmute** uses a two-color picker modal.

---

## Relics (15)

**Source of truth:** `src/content/relics.ts`. Most new relics are **upgradable** at rest nodes.

| ID | Rarity | Hook | Effect (summary) |
|----|--------|------|-------------------|
| iron-buckler | common | onMatch(blue) | +1/+2 blue pool per blue match |
| sharp-edge | common | onMatch(red) | +1/+2 red per red match |
| thornmail | common | onDamageTaken | Reflect 1/2 to attacker (resolved in combat, not FX-only) |
| cascade-crystal | uncommon | onMatch (cascade≥1) | ×1.5 all pool deltas on chain links |
| stoneheart | rare | onFatalDamage | Once per run: survive lethal at 1 HP |
| **harvester** | uncommon | onEnemyKilled | 2/3 damage to random other enemy |
| **morning-star** | common | onPhaseStart | If block 0: gain 3/5 block |
| **afterburner** | uncommon | onPhaseEnd | Spend leftover red pool as damage (half/full) |
| **avalanche** | uncommon | onCascade (≥2) | 1/2 damage to all enemies |
| **fortified** | common | onBlockGained | +1/+2 block once per phase when you gain block |
| **spite** | uncommon | onBlockBroken | 2/3 Vulnerable to target when your block breaks |
| **overcharge** | rare | onUltimateUsed | 2/3 Burn to all enemies |
| **war-drum** | uncommon | onRoundStarted | 2/3 Strength at fight start |
| **collectors-eye** | common | onRelicGained | Heal 5/8 HP on pickup |
| **battle-cry** | common | onSpellCast | 1/2 damage to target |

**Hook emissions → state:** Relics that emit `damage-dealt` (`relic-effect`), `block-gained`, `healed`, or `status-applied` are applied via `applyCombatEvents` in `src/core/combat/applyCombatEvents.ts` (swap, cascade, fight start, relic pickup, etc.). Modifier-style hooks (`onMatch` payload rewrite, Stoneheart intercept) still use their existing paths.

**Hook coverage:** All 15 relic hook kinds in `RelicDef` are now used by at least one shipped relic.

---

## Status effects (5)

| Kind | Behavior |
|------|----------|
| burn | DoT: damage = stacks, then decay |
| vulnerable | +50% damage taken while stacks > 0 |
| weak | −50% damage dealt while stacks > 0 |
| regen | Heal stacks HP at owner phase start, then decay |
| strength | Flat outgoing damage bonus; does not decay per tick |

---

## Systems added in mechanics expansion

1. **Enrage** — `enraged` flag on enemy; pattern index resets; `enemy-enraged` event.
2. **Drained colors** — fight-level list (Leech); ticks like hexed colors.
3. **`applyCombatEvents`** — bridges relic hook emissions to HP/block/status state.
4. **Gold** — sixth gem color; economy unchanged (match + drops + shop).

---

## Doc drift notes

- **Boss name:** slice docs sometimes say "Corruptor"; shipped boss archetype is **Tyrant** (`tyrant`).
- **Relic count in old scope:** was "~20 with 10 TBD"; shipped pool is **15** with full hook coverage. More relics = post-slice content pass.
- **Enemy count:** was "6 + boss"; shipped roster is **9 fight archetypes + Tyrant**.
