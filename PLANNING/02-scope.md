# Vertical slice scope

Status: **Phase 1 complete.** Content list and structure locked. Ready for Phase 2 (architecture).

This doc nails down **exactly what ships** in the playable vertical slice. The rule: if it's not listed here, it's not in v1.

---

## "Done" definition

The slice is complete when:
- A player can start a fresh run, navigate the branching map, fight 6-8 encounters including a boss, pick relics between fights, visit a shop, die or win, and start over.
- All systems in `01-design.md` are functional: turn structure, 5 gem pools, cascade multipliers, Knight class with 2 spells + 1 ultimate, telegraphed enemy intents, relic event-hook system.
- ~20 relics, ~6 enemy types + 1 boss, 1 player class (Knight).
- Stylized-simple visuals: custom SVG gems, simple enemy sprites, match animations (squash/stretch + particles).
- Runs reproduce from a seed (RNG is seeded).
- Auto-save at phase boundaries — closing the tab mid-run, then returning, resumes the run from the last completed phase (post-fight, post-pick, post-shop, post-node-entry).

---

## ✅ Content list

### Player class: Knight (locked)
- HP, base block, spell costs, ultimate charge requirement — TBD numbers in this doc

### Gems: 5 colors + 5 shapes (locked)
Red / Blue / Green / Yellow / Purple, each with a **unique SVG silhouette** so color is not the only differentiator:

| Color  | Shape    |
|--------|----------|
| Red    | Diamond  |
| Blue   | Teardrop |
| Green  | Leaf     |
| Yellow | Star     |
| Purple | Hexagon  |

This is an asset-level accessibility shim — no toggle, no color-blind mode (still a non-goal). The board just *happens* to be legible without color. Costs an afternoon of SVG work at Phase B and pays for itself forever.

### Enemies: 6 archetypes (locked, numbers + verbs TBD)
Per *Enemies share the board* (`01-design.md`), identity archetypes have a **board verb** in addition to (or instead of) direct damage. Verbs below are **candidates** — locked when each archetype's build phase opens (Brute already shipped in Phase E without a verb; see roadmap note).

| Enemy | Lesson | Board verb (candidate) | Behavior sketch |
|-------|--------|------------------------|------------------|
| **Brute** | Block on telegraph | **Column smash** — destroys all gems in one telegraphed column (no payout, refills from top); player gets one phase warning to clear/match that column for value first | High HP, alternates column-smash and big single-target attack |
| **Skirmisher** | Sustained damage | *(none — connective tissue)* | Low HP, attacks every turn for small damage. The "pure stat" archetype that keeps the early curve gentle |
| **Caster** | Priority targeting | **Color hex** — marks one gem color as hexed for 2 turns; matching hexed gems applies 1 stack of Weak per cell (telegraphed: the player can see which color is about to become a trap) | Fragile, alternates hex with Weak/Vulnerable direct debuffs |
| **Defender** | Breakthrough matters | **Petrify row** — locks one row from being matched for 2 turns (gems still cascade through; just can't be the anchor of a match) | Gains block each turn; petrify forces the player to route matches around the wall |
| **Swarmer** | AOE + target switch | **Cluster shove** — slides a 2-cell run of one color across the board to clump with another (creates a match the player didn't plan; can be useful, can ruin a set-up — telegraphed enough to react) | Appears in groups of 2-3, weak individually |
| **Bleeder** | Status fx threat | **Tile burn** — flags 1-2 cells as burning for 2 turns; matching a burning cell applies 1 stack of Burn per cell | Attacks also apply Burn directly — the verb amplifies, doesn't replace |

**Architectural note:** every board verb reads/writes the existing `Cell.flags` bag (`cursed` is the prototype; add `petrified`, `hexed`, `burning`, `pending-smash` as needed). Match algorithm and cascade loop stay unchanged — verbs only affect generation, resolution, or matchability checks. See `03-architecture.md` §Cell.

### Boss: Corruptor (locked, numbers TBD)
- High HP, multi-phase intents.
- Every 2nd turn: converts 2 random gems to **cursed** (visually distinct overlay).
- Cursed gems match normally, but each cursed cell in a resolved match deals **1 self-damage** to the player. A 3-match with 1 cursed gem costs 1 HP; a 5-line with 3 cursed costs 3 HP. Damage scales with how much corruption the player chose to swallow, not with match size, so clearing the board is always *possible* — just costly.
- **Self-damage bypasses Vulnerable.** Cursed self-damage is a fixed 1 HP per cursed cell regardless of player statuses — Vulnerable amplifies only `enemy-attack` sources (see `DamageSource` in `03-architecture.md`). Same reason Thornmail doesn't reflect on cursed matches: the source is `self-curse`, not the enemy.
- Forces player to plan around the board, build block on corruption turns, and accept some self-damage.
- ⚠ Architecture note: cursed-state is a per-cell flag, not a new gem color. Match algorithm is unchanged — only the resolution step reads the flag and sums `cursedCellsInMatch` to compute self-damage.

### Relics: ~20 total — 10 specced now, 10 designed during execution

**Common (5 of ~10 specced):**
| Name | Style | Hook | Effect |
|------|-------|------|--------|
| Iron Buckler | Scoring | onMatch(blue) | Blue matches give +1 block |
| Sharp Edge | Scoring | onMatch(red) | Red matches give +1 attack |
| Focus Crystal | Scoring | onMatch(yellow) | Yellow matches give +1 mana |
| Thornmail | Combat | onDamageTaken | When you take damage, deal 1 back |
| First Aid | Scoring | onMatch(green) | Green matches give +1 heal |

**Uncommon (3 of ~7 specced):**
| Name | Style | Hook | Effect |
|------|-------|------|--------|
| Cascade Crystal | Scoring | onCascade(n≥2) | 2nd+ cascades give +50% payout |
| Vampiric Sigil | Combat | onEnemyKilled | On kill, heal 5 HP |
| Stoic Plate | Scoring | onPhaseEnd | Unused block converts: every 5 block → +1 attack next phase |

**Rare (2 of ~3 specced):**
| Name | Style | Hook | Effect |
|------|-------|------|--------|
| Stoneheart | Combat | onFatalDamage | First time you'd die per run, survive at 1 HP |
| Mirror Plate | Combat | onDamageTaken | First enemy hit each fight: counter for blocked amount |

**Hook coverage check:** onMatch(color), onCascade, onDamageTaken, onEnemyKilled, onPhaseEnd, onFatalDamage — covers the main hooks the architecture needs to support. Remaining 10 relics fill in onPhaseStart, onSpellCast, onBlockGained, onRoundStarted, onRelicGained, etc. The unused hooks (onRoundStarted, onRelicGained, onPhaseStart, onSpellCast, onUltimateUsed, onBlockGained, onBlockBroken, onDamageDealt, onEnemyIntent) are still wired by the engine in Phase G so the J2 content fill can plug into them without architecture churn.

Remaining ~10 relics designed during execution alongside playtest feedback.

### Status effects: 3 (locked)
| Status | Type | Effect | Re-application |
|--------|------|--------|----------------|
| **Burn** | DoT | `stacks` damage at **start of owner's phase/turn**, `duration` decrements by 1 same tick | **Stacks damage + refreshes duration to max of (current, new).** |
| **Vulnerable** | Debuff | Owner takes +50% damage for `duration` phases/turns | **Refreshes duration only.** Multiplier does not stack — Vulnerable is binary on/off. |
| **Weak** | Debuff | Owner deals -50% damage for `duration` phases/turns | **Refreshes duration only.** Multiplier does not stack — Weak is binary on/off. |

All three share the same shape: `{ stacks: int, duration: int }`. Stored as a map on player/enemy entities. Single render path for status icons + tooltip. **Rule of thumb: DoT stacks build up, multiplier debuffs refresh duration only.** Prevents Vulnerable spiraling into damage-pipeline breakage; keeps Burn feeling like a build-up.

**Tick granularity (locked):**
- On **player**: status ticks fire **once at phase start**, not per-swap. Burn deals stacks once, duration counts down by 1. Extra-turn cycles inside the same phase do **not** retick. Player phase = 1 duration unit.
- On **enemy**: status ticks fire **once at the start of that enemy's turn** (each enemy ticks on its own turn-start). Enemy turn = 1 duration unit.

This makes "duration: 3" mean "3 of the owner's turns/phases" consistently and prevents extra-turn chains from accidentally chewing through debuffs faster than the enemy can act.

### Special tiles: simple (locked)
- **3-match**: base payout.
- **4-match**: bigger payout + extra turn. **No power gem spawned.**
- **5-line match**: bigger payout + clears entire row or column of that gem color (chains into cascades).
- **T or L match**: bigger payout + clears 3×3 area or +-shape (chains into cascades).
- No persistent special tiles on the board. All effects resolve immediately as part of cascade resolution.

---

## ✅ Difficulty curve — rough targets (tune during playtest)

Initial numbers, expected to change:
- **Player base HP**: 60
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
    [c4] [c4]            col 4: rest + shop (or 2 shops)
        |
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
- 1-2 shops (player picks 1 via path)
- 1 rest (player may skip via different path)
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
