# Vertical slice scope

Status: **Phase I complete.** Mechanics expansion catalogued in **`10-shipped-content-catalog.md`** (2026-05-27).

This doc nails down **exactly what ships** in the playable vertical slice. The rule: if it's not listed here, it's not in v1.

---

## "Done" definition

The slice is complete when:
- A player can start a fresh run, navigate the branching map, fight 6-8 encounters including a boss, pick relics between fights, visit a shop, die or win, and start over.
- All systems in `01-design.md` are functional: turn structure, gem pools (incl. gold), cascade multipliers, Knight starters + discoverable spell pool, telegraphed enemy intents, relic event-hook system.
- **15 relics**, **9 fight archetypes + Tyrant (boss)**, 1 player class (Knight). See `10-shipped-content-catalog.md` for the live roster.
- Stylized-simple visuals: custom SVG gems, simple enemy sprites, match animations (squash/stretch + particles).
- Runs reproduce from a seed (RNG is seeded).
- Auto-save at phase boundaries — closing the tab mid-run, then returning, resumes the run from the last completed phase (post-fight, post-pick, post-shop, post-node-entry).

---

## ✅ Content list

### Player class: Knight (locked)
- HP, base block, spell costs, ultimate charge requirement — TBD numbers in this doc

### Gems: 5 colors + 5 shapes (locked)
Red / Blue / Green / Yellow / Purple, each with a **unique SVG silhouette** so color is not the only differentiator:

| Color  | Shape    | Cryptic theme nod |
|--------|----------|-------------------|
| Red    | Diamond  | Sharp/blade — combat |
| Blue   | Shield (kite) | Defense — silhouette itself reads as shield |
| Green  | Leaf     | Nature/herb — healing |
| Yellow | Star     | Spark — mana |
| Purple | Hexagon  | Runic/arcane — skill charge |

This is an asset-level accessibility shim — no toggle, no color-blind mode (still a non-goal). The board just *happens* to be legible without color. Silhouettes also carry a faint thematic nod to each gem's function (a shield-shape for block, a leaf for heal) — cryptic enough to not feel like clip-art, legible enough that a new player picks it up subliminally alongside the trail-routing visuals. Costs an afternoon of SVG work at Phase B and pays for itself forever.

### Enemies: 9 archetypes + boss (shipped)

All archetypes below are **implemented** with board verbs where noted. Patterns, HP, and ranges: `src/content/enemies.ts`. Full behavior summary: **`10-shipped-content-catalog.md`**.

| Enemy | Board verb | Notes |
|-------|------------|-------|
| Skirmisher | — | Pure attack; early-curve filler |
| Brute | Column smash | Enrage: more smashes, drops block phase |
| Smolder | Tile burn + Burn on hit | Enrage: faster burn alternation |
| Rallier | buff-ally (Strength) | Multi-enemy only |
| Defender | Petrify row | Enrage: trades one petrify for attacks |
| Caster | Color hex → Weak | — |
| Swarmer | Cluster shove | Groups of 2–3 |
| **Leech** | Color drain → heals Leech | Mid/late map |
| **Shade** | Lifesteal (50% of damage dealt) | Mid/late map |
| **Trickster** | Trick (`???` → attack or block) | Mid/late map |

**Architectural note:** board verbs use `Cell.flags`, `FightState.hexedColors` / `drainedColors`, and `petrifiedRows` as appropriate. Match/cascade core unchanged.

### Boss: Tyrant (shipped)

> **Doc rename:** early scope called this fight "Corruptor" (cursed-gem gimmick). Shipped boss is **Tyrant** — column smash, petrify, tile burn, block, enrage at 50% HP. Numbers in `enemies.ts`.

### Relics: 15 shipped (full hook coverage)

Original scope listed ~20 with many TBD. **15 relics** are in `src/content/relics.ts`, including the mechanics-expansion batch (Harvester, Morning Star, Afterburner, Avalanche, Fortified, Spite, Overcharge, War Drum, Collector's Eye, Battle Cry).

Hook emissions that change combat state go through **`applyCombatEvents`** (see `03-architecture.md` / catalog). Modifier hooks (`onMatch`, `onFatalDamage`) unchanged.

**Catalog table:** `10-shipped-content-catalog.md` §Relics.

### Status effects: 5 (shipped)
| Status | Type | Effect | Re-application |
|--------|------|--------|----------------|
| **Burn** | DoT | At **start of owner's phase/turn**, deals `stacks` damage, then `stacks -= 1` (decay-while-damaging) | **`stacks += incoming.stacks`** (accumulates both damage AND remaining turns) |
| **Vulnerable** | Debuff | Owner takes +50% damage from attacks while `stacks > 0`; each tick `stacks -= 1` | **`stacks = max(current, incoming.stacks)`** (refresh; multiplier stays binary on/off) |
| **Weak** | Debuff | Owner deals -50% damage with attacks while `stacks > 0`; each tick `stacks -= 1` | **`stacks = max(current, incoming.stacks)`** (refresh; binary multiplier) |
| **Regen** | HoT | Heals `stacks` at owner phase start, then decays | Accumulates stacks |
| **Strength** | Buff | Flat bonus to outgoing damage; no per-tick decay | Refreshed via `max` where applicable |

All three share the same shape: `{ stacks: int }`. **One number per status (StS pattern)** — `stacks` is both the magnitude and the turns-remaining; each tick decays it by 1. 3 Burn → ticks 3, 2, 1 → expires (6 damage over 3 turns). 2 Vulnerable → multiplier active for 2 turns, then expires.

Stored as an array on player/enemy entities. Single render path for status icons + tooltip showing the current `stacks`.

**Tick granularity (locked):**
- On **player**: status ticks fire **once at phase start**, not per-swap. Burn deals current stacks, then all statuses decrement stacks by 1. Extra-turn cycles inside the same phase do **not** retick. Player phase = 1 stacks unit.
- On **enemy**: status ticks fire **once at the start of that enemy's turn** (each enemy ticks on its own turn-start). Enemy turn = 1 stacks unit.

This makes "3 Burn" / "2 Vulnerable" read consistently as "this many of the owner's turns" and prevents extra-turn chains from accidentally chewing through statuses faster than the enemy can act.

### Special tiles: simple (locked)
- **3-match**: base payout.
- **4-match**: bigger payout + extra turn. **No power gem spawned.**
- **5-line match**: bigger payout + clears entire row or column of that gem color (chains into cascades).
- **T or L match**: bigger payout + clears 3×3 area or +-shape (chains into cascades).
- No persistent special tiles on the board. All effects resolve immediately as part of cascade resolution.

---

## ✅ Difficulty curve — rough targets (tune during playtest)

Initial numbers, expected to change:
- **Player base HP**: 40
- **Player Resolute passive**: +2 block at start of player phase, +1 per consecutive prior phase with no blue pool (cap +5)
- **Knight spell costs**: Bulwark 3 mana (consumes blue pool, converts to attack at `floor(blue / 2)`), Reinforce 4 mana (doubles this phase's block on carry-over)
- **Knight ultimate cost**: 8 purple charge

**Enemy scaling (HP / damage per hit):**
| Tier | HP range | Damage range |
|------|----------|--------------|
| Early (col 1-2) | 10-20 | 3-5 |
| Mid (col 3-4) | 20-35 | 5-8 |
| Elite | 50-70 | 8-12 |
| Boss (Corruptor) | 120 | 10-15 + curse damage |

**Economy:**
- Gold per normal fight: 10-15
- Gold per elite: 25-35
- Shop prices: relic 30-60 (by rarity), heal-20HP for 25, relic-remove for 50

**Design intent:** competent player clears ~50-60% of runs on first pass (slice doesn't have meta-progression to soften deaths, so it should be slightly more forgiving than full roguelikes).

---

## ✅ Map structure (locked)

### Layout: 4 encounter columns + 1 boss column (5 total)
```
       [start]
      /   |   \
    [c1] [c1] [c1]      col 1: 3 fight nodes
     |  X  |  X  |       (player picks one, edges connect to col 2)
    [c2] [c2]            col 2: 2 nodes (1 fight + 1 shop OR 2 fights)
     |  X  |
    [c3] [c3] [c3]      col 3: 3 nodes (mix of fight + elite)
     |  X  |  X  |
    [c4] [c4]            col 4: rest + shop (always one of each — "2 shops"
        |                       would break the ≥1-rest-reachable guarantee)
      [BOSS]             col 5: boss
```

### Path generation rules
- Procedural per-run, seeded by run RNG.
- **Guarantees** per run:
  - At least 1 shop accessible from any path
  - Exactly 1 elite (in col 3)
  - At least 1 rest accessible
- Edge generation: each node connects to 1-2 nodes in next column (some shared, creating branching choice).

### Node distribution
- ~5-6 fights per run (depending on path)
- 1 elite
- 1-2 shops (col 4 always has one; col 2 may add a second on the fight+shop variant — player picks which to walk into via their col-3→col-4 edge)
- 1 rest (always present in col 4; reaching it forecloses the col-4 shop on that run)
- 1 boss

---

---

## ❌ Explicit non-goals for slice

These are **not in v1**, even if tempting:
- ❌ Multiple player classes (Berserker, Mage, etc.)
- ❌ Board-rule modifiers (diagonal matches, gravity changes, etc.)
- ❌ Synergy modifiers / relic tagging system
- ❌ Meta-progression (unlocks between runs)
- ⚠ Audio: **4 placeholder SFX only** (gem clear, cascade, damage, victory). No music. Carved out during the Phase D→E polish intermission — full audio remains a non-goal.
- ❌ Multiple acts (one act → boss → end)
- ❌ Daily seeded runs, leaderboards
- ❌ Mid-fight save resilience (auto-save only fires at phase boundaries — closing tab mid-cascade rolls back to start of fight)
- ❌ Mobile / touch optimization (desktop only)
- ❌ Accessibility passes (color-blind modes, screen reader)
- ❌ Settings / options menu beyond start/restart
- ❌ Polished art (pixel art, animated sprites) — stylized-simple only
- ❌ Tutorial — pop-up tooltips at most

---

## ✅ Phase 1 complete

All scope questions resolved. Boss = Corruptor, enemies = balanced 6, statuses = Burn/Vulnerable/Weak, special tiles = simple, difficulty = rough targets (tune during playtest), map = 4-column procedural with guarantees, relics = 10 specced + 10 designed during execution.

**Next:** Phase 2 architecture (`03-architecture.md`).
