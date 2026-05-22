# Game design

Status: **Phase 0 complete.** Systems-level design locked. Content-level decisions (difficulty curve, status effects, special tiles, boss gimmick choice) handed to Phase 1 scope-lock.

---

## ✅ Core turn structure (locked)

### Turn flow
1. **Player turn**: one swap → resolve cascades → matches resolve effects → check for "extra turn" → enemy turn (unless extra turn earned).
2. **Enemy turn**: telegraphed intents above sprite resolve (attack, block, debuff, board effect). Enemy then re-telegraphs next intent.
3. **Loop** until player or all enemies dead.

### Player actions
- One swap per turn.
- Match of **4+** grants an extra turn.
  - **No cap on extra-turn chains.** A lucky cascade can grant several extra turns in a row; that's a signature feel of the genre and 4+ matches are rare enough that the value is bounded in practice.
  - **Enemy intent stays locked across extra turns.** The icon/number the player saw at the start of the player turn does not re-roll mid-combo. The player swapped *because* of that intent; changing it mid-turn would break the planning loop.
- Invalid swaps revert (no turn consumed) — standard match-3 affordance.

### Enemy behavior
- **Telegraphed intents** (Slay-the-Spire style). Icon + number above enemy:
  - ⚔ N — attacks for N next turn
  - 🛡 N — blocks N
  - ☠ debuff — applies status
  - 🌀 board — manipulates board (see *Enemies share the board* below — this is the signature verb, not a side category)
- Intent visible **before** player's turn so they can plan.
- Each enemy has a **hybrid** intent pattern: the *kind* follows a fixed per-archetype script (e.g. Brute: ⚔, 🌀, ⚔, …), but the *numeric value* (damage, block amount) and the *target* of board verbs (which column, which color) roll from `rng.enemy` within archetype-defined constraints. Players can learn the rhythm of intents and plan around them; numbers and targets stay varied enough that fights don't feel canned. Patterns repeat from the start of each encounter so the player sees the same intent kind at the same turn index regardless of when they entered the fight.

### Enemies share the board (locked direction)

Pivot from the original framing: enemies don't just attack and defend — their **signature verb is board manipulation**. Telegraphed intents still drive the planning loop, but the intent typically targets *the grid itself*, not just the player's HP bar. This is how the game stakes out its own ground between two reference points:

- **Not Puzzle Quest:** the enemy never takes matching turns. The player owns the matching loop; pacing stays tight.
- **Not pure Slay the Spire:** the enemy's intent isn't just damage/block. It reshapes the board the player has to play on.

Each enemy archetype gets a distinctive **board verb** — smashes a column, corrupts a color, locks a row, hexes a tile. The verb is:
- **Legible from the intent telegraph** (the player can see what's about to happen and where).
- **Counterable through play** (clear the threatened cells, deny the target, sequence around the lockout).
- **Built on the cell-flags primitive** already established for cursed cells — same architecture, different flag.

Identity enemies become *puzzles*, not HP bars with different damage numbers. Direct damage / block intents stay in the kit as connective tissue (a Brute might smash a column *and* attack on alternating turns), and one or two pure-stat archetypes (e.g. Skirmisher as chip-damage threat) keep the early curve gentle. The boss is the most extreme board verb, not the only one — Phase J1's Corruptor work is the first full instance of a broader system, not a one-off gimmick.

Specific archetype verbs are listed in `02-scope.md` as candidates; each is locked when its build phase opens.

### Match → combat mapping (gems-as-resources)
Five gem colors, five pools. Matching gems fills the corresponding pool.

| Color  | Pool    | Persistence | Effect |
|--------|---------|-------------|--------|
| Red    | Attack  | Per-phase meter | Damage commits **per-match** during the cascade (Plan B). Pool stat tracks total dealt this phase for relic hooks |
| Blue   | Block   | Per-phase   | Resolves at end of player phase → sets block stat (the wall waiting for the enemy) |
| Green  | Heal    | Per-phase meter | Heal commits **per-match** during the cascade (Plan B). Pool stat tracks total healed this phase for relic hooks |
| Yellow | Mana    | Persistent  | Credited immediately on match; spent by active spells |
| Purple | Skill   | Persistent  | Credited immediately on match; full charge unlocks ultimate, drained on use |

**Clean split:** combat resources (red/blue/green) are tactical and refresh every player phase — forcing players to plan around enemy intents. Casting resources (yellow/purple) are strategic and accumulate — letting players save for big moments. This split is also where most modifiers will hook in: "block carries over 1 phase", "convert unused red to mana", "yellow auto-converts to skill", etc.

### End-of-turn = end-of-player-phase
A **player phase** is the full window from when the player regains control until the enemy is next to act. A 4+ match grants an extra turn, but the phase continues — all extra-turn cycles belong to the same phase. Effects tagged "end-of-turn" (block snap-into-stat, block decay, Resolute, Bulwark, queued spell effects, etc.) fire **once per phase**, at the moment the enemy is up next.

**Per-match commit for damage and heal (Plan B).** Red (damage) and green (heal) deviate from "everything resolves at EOP": they commit *as each gem match happens* during the cascade. The pip-of-loaded-damage UI that the EOP model implied turned out to feel awkward (transient pre-commit state on the bar with no payoff beat the per-match popups didn't already deliver), and per-match commit also opens up the more interesting relic surface (multi-hit synergies, per-hit DoTs, streak/threshold rewards). Blue (block) keeps the EOP model because it needs to be ready *before* the enemy attack — that timing is load-bearing for defense planning. Cascade multipliers and `onMatch` modifier hooks still apply to red/green deltas the same way; the difference is the delta resolves into a `damage-dealt` / `healed` event immediately rather than queuing into a pool. `phasePools.red` / `phasePools.green` still increment as **running meters** for the phase so relics that want "how much you dealt/healed this phase" can read them at EOP.

### Match-size scaling
| Match | Effect |
|-------|--------|
| 3     | Base payout to color's pool |
| 4     | Bigger payout + **extra turn** + spawns special tile? (TBD) |
| 5 (line) | Even bigger + **clears row or column** of matched color |
| T / L     | Big payout + **clears area** (3x3 or +-shape) |

### Cascade multiplier
- 1st cascade: ×1
- 2nd: ×1.5
- 3rd: ×2
- 4th+: ×3
- This multiplier is the **primary hook for scoring modifiers** (Balatro-style).
- **Multiplier scope:** scoring modifiers (the cascade multiplier itself and relics like Cascade Crystal) apply to **all five pool deltas** — red, blue, green, yellow, purple. Cascading is a build-defining engine for spell economy, not just combat resources.
- **Rounding rule (global):** all fractional pool deltas, multiplier outputs, and conversions **floor** to integer at the moment they land. `floor(3 × 1.5) = 4`. Consistent across cascade multipliers, relic modifiers, Bulwark conversion, and any future value-modifying hook. Implemented once in a shared `applyMultiplier(amount, mult)` helper so the rule is not re-decided per caller.

---

## ✅ Abilities, resources, targeting (locked)

### Abilities
- **Free action between swaps.** Player may cast spells at any moment during their phase, as long as: it's the player's phase, the board is settled (no resolution in flight), and the player can pay the cost. Casting does not consume the swap or end the phase.
- Ultimate (purple-skill) on **charge-only cooldown** — usable when full, drains charge on use.
- Slice class has: 2 base spells (mana cost) + 1 ultimate (skill charge).

### Block
- **Player block: per-phase, use-it-or-lose-it.** Blue pool resolves at end of player phase → sets the block stat → persists through the enemy turn → zeroed at the start of the next player phase, *before* Resolute fires. Forces real choice between matching red (attack) and blue (defense) based on enemy intent.
- **Enemy block: persistent until depleted.** Enemies that gain block (e.g. Defender's `🛡 N` intent) accumulate it — the value stays on the enemy across turns until incoming damage chips it down to zero. Asymmetric with the player on purpose: Defender is supposed to feel like a wall the player has to grind through, not a damage sponge that resets every turn.
- Modifiers can later add persistence on the player side ("Block carries over 1 phase", "Unused block converts to attack", etc.) — a clean modifier hook.

### Heal
- Pooled, auto-spent end-of-turn. No overheal. Capped at max HP.

### Targeting
- Click enemy to select. Red damage / single-target effects hit selected.
- 5-line and T/L matches are **AOE**, hit all enemies.
- Default target = leftmost enemy at fight start.

### Slice class: **Knight**
- Identity: blue/defense-focused, sustain through block, punishes incoming attacks.
- Easier to balance for v1 — block is a well-understood lever (one number, one effect).
- **Class passive:** *Resolute* — at start of player phase, +2 block, plus +1 per consecutive prior phase that resolved without any blue pool (cap +5 total). Smooth scaling that rewards blue-drought without making blue matches pointless. No pity-counter UI; the player sees the block tick up.
  - **Counter reset rule:** "no blue pool" means **no blue gems were matched this phase**. If the player matched blue (even if Bulwark later consumed the pool for attack), the counter resets to 0. Bulwark doesn't punish Resolute scaling — the player chose to play blue, that's what counts.
- **Spells (cost yellow mana):**
  - *Bulwark* (~3 mana) — **resolves end-of-phase, consumes blue**: at end of player phase, before block decay, the entire blue pool earned this phase is converted to attack at `floor(bluePool / 2)` (the classic blue→red conversion modifier hook, built-in to class). **Block is consumed** — no defense from blue this phase. Pay mana on cast; the effect queues and fires when the phase ends, so cascades and extra-turn chains all funnel into one big conversion. Odd blue counts always floor: 5 blue → 2 attack, 7 blue → 3.
  - *Reinforce* (~4 mana) — at end of player phase, **doubles** this phase's block on carry-over (single-use override: instead of decaying to zero at start of next phase, block becomes `block × 2` and then decays normally the phase after).
    - **Interaction with Bulwark:** if both are queued, **Bulwark wins** — blue pool is consumed for attack, block this phase is zero, and Reinforce doubles zero (effectively wasted). UI shows both icons in the spell-queue tray with Reinforce visibly dimmed once Bulwark is queued, so the trap is legible. No mana refund — paying the cost is the lesson.

> **Spell-timing rule:** spells are cast as a free action **between swaps** during the player's phase. The cast window is open whenever (a) it's the player's phase, (b) the board is settled (no cascade in flight), and (c) the player can pay the cost. Effects that read end-of-phase state (Bulwark, Reinforce) pay their cost on cast and **queue into the end-of-phase resolution step**.
>
> **Each end-of-phase spell can be queued at most once per phase.** Once a spell is queued, its button locks for the remainder of the phase — prevents same-spell stacking (no double-Bulwark, no double-Reinforce). Different spells can be queued together (Bulwark + Reinforce is allowed; see the interaction note above).
>
> A small **pending-effects strip** in the HUD (next to the phase indicator, not a dedicated tray) shows icons for spells that have been cast this phase but resolve at end-of-phase — Bulwark and Reinforce currently. This is *visibility only*, not a batching UI: each spell was already cast and paid for individually as soon as the player clicked it. The strip just tells the player what's pending. Hovering an icon shows the effect summary.
- **Ultimate (full purple charge):** *Riposte* — for the **next enemy turn only**, if that turn includes an attack, take 0 damage and counter-attack for the **full incoming pre-block damage** (parries the entire blow back at the attacker). If the enemy's next turn is a block / debuff / board action with no attack, Riposte **expires unused** at the end of that enemy turn. Read the telegraph before casting — Riposte on a Defender's block turn is a wasted ultimate, and that's the cost of misreading intent.
- Showcases: combat-effect modifiers (Bulwark/Riposte are class-built versions of what relics will do at scale), block-conversion design space, and the modifier-override pattern (Reinforce temporarily bends the decay rule).

> **Future class — Berserker** (deferred to post-slice): red-focused, scaling on cascades, ×2/×3/×4 cascade multiplier. Will exercise scoring-modifier hooks once those are proven with simpler levers.

---

## ✅ Run structure (locked)

### Shape: Slay-the-Spire-style branching map
- Small graph, 6-8 encounters from start to boss.
- ~3 columns of nodes, 2-3 nodes per column, edges between adjacent columns.
- Player picks a starting node, then chooses path forward at each step.
- ⚠ Note: branching at this scope is small, but still adds UI + path-validation work over linear. Worth it for the "real roguelike feel".

### Length: ~6-8 encounters, ~10-15 minutes
- Approx: 4-5 normal fights + 1 mini-boss (elite) + 1-2 choice nodes (shop / rest) + 1 boss.

### Node types
| Node    | Icon | What happens |
|---------|------|---------------|
| Fight   | ⚔    | Normal combat encounter, drops relic + gold |
| Elite   | 💀   | Harder fight, drops *better* relic + more gold |
| Shop    | 💰   | Spend gold on relics, board upgrades, heals, relic removes |
| Rest    | 🔥   | Heal ~30% HP **or** upgrade a relic |
| Boss    | 👑   | Final encounter — gimmick boss |

### Reward cadence
- **After every fight**: pick 1 of 3 relics + gold drop.
- **After elite**: pick 1 of 3 *better* relics + extra gold.
- **After boss**: run completes (slice ends; full game would continue to next act).

### Shop economy
- Gold drops: ~10-20 per fight, ~30-40 per elite.
- Shop offers: 3 relics (variable cost), 2 heals, 1 relic-remove, 1 board-upgrade (TBD what these do).

### Boss: one boss, one gimmick
- One designed boss for the slice with a **scaled-up board verb**. Since every identity enemy now has a board verb (see *Enemies share the board*), the boss differentiates on scale, persistence, and severity — not category.
- Candidate gimmicks (pick one in Phase 1):
  - **Petrifier**: every 3rd turn, locks a random column (gems can't be matched there for 2 turns)
  - **Corruptor**: every 2nd turn, converts 2 random gems to "cursed" gems (matching cursed = self-damage)
  - **Wall**: spawns indestructible block-tiles in random spots; player must work around them
- The cell-flags architecture proven on Corruptor is the same one all other enemy board verbs ride on, so the boss exercises the system to its limit rather than introducing a one-off mechanic.

---

## ✅ Modifier system (locked)

### Two styles for slice: **Combat-effect + Scoring**
Both attach via the **same event-hook architecture**. One system, two content flavors. Board-rule and synergy modifiers deferred to post-slice.

### Event-hook model
Relics subscribe to game events and can:
- **Modify values in flight** (scoring modifiers — e.g. "multiply red payout by 1.5")
- **Trigger side effects** (combat-effect modifiers — e.g. "on 4-match, deal 3 damage to all enemies")

Candidate hooks (final list locked in Phase 2 architecture):
- `onMatch(color, size, shape)`
- `onCascade(cascadeNum)`
- `onPhaseStart` / `onPhaseEnd` (a **phase** spans the player's regaining control through to the enemy acting; extra-turn cycles are inside one phase, so these hooks fire **once per phase**, not per swap)
- `onRoundStarted` (once per encounter, before phase 1 — for per-fight setup effects)
- `onDamageDealt` / `onDamageTaken`
- `onBlockGained` / `onBlockBroken`
- `onEnemyIntent` (read enemy plans, react)
- `onEnemyKilled` / `onFatalDamage`
- `onSpellCast` / `onUltimateUsed`
- `onRelicGained` (fires when a relic is added to the player — for relics that grant a one-shot bonus on pickup, e.g. "+10 max HP")

Hooks are pure where possible (no implicit ordering between relics for read-only listeners); for write hooks (value modifiers), evaluation order is **relic-acquisition order** (predictable, debuggable).

### Pool: ~20 relics, common/uncommon/rare
- **~10 common** — small consistent effects (+1 to a thing, trigger on common events)
- **~7 uncommon** — bigger or conditional effects
- **~3 rare** — build-defining effects, run-shaping (drop only from elites and boss)

### Stacking: unique only
- Pick screens filter out already-owned relics.
- No duplicate-stacking complexity. Cleaner balancing, encourages variety per run.

### Example relics (illustrative, final list in Phase 1 scope)
| Name | Rarity | Style | Effect |
|------|--------|-------|--------|
| Iron Buckler | Common | Scoring | Blue matches give +1 block |
| Sharp Edge | Common | Scoring | Red matches give +1 attack |
| Thornmail | Common | Combat | When you take damage, deal 1 back |
| Cascade Crystal | Uncommon | Scoring | 2nd+ cascades give +50% |
| Vampiric Sigil | Uncommon | Combat | On kill, heal 5 HP |
| Stoneheart | Rare | Combat | At 0 HP, survive once at 1 HP |
| Mirror Plate | Rare | Combat | First enemy attack each fight: counter for blocked amount |

---

## ⏳ Deferred to later in Phase 0
- Run structure (map, encounters, shop, boss)
- Modifier system design (which 2 styles for slice, how they hook in)
- Difficulty curve
- Status effects catalogue (burn, freeze, poison, etc.)
- Special tile system (do 4-matches spawn power gems? what do they do?)
