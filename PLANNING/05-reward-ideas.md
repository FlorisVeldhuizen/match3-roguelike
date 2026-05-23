# Reward Ideas — Brainstorm

Status: exploratory. Not committed. Goal: pressure-test a hybrid economy where on-board money funds tactical choices, normal encounters shape *how the board plays*, and relics (elite/boss only) shape *the whole run*.

---

## Money Gems

### Core idea
A new on-board gem type that yields gold when matched. Gold is spent between encounters (shop, heals, rerolls). Makes economy a *tactical* choice during combat — "do I take the damage match or the money match this turn?"

### Open design questions
- **Spawn source.** Spawn only on cascades, never on initial board fill? This keeps money out of the way until the player earns the chance at it, and avoids diluting combat tiles in early-turn boards.
- **Color identity.** Is money a 7th color (competes for matches with combat colors) or a *modifier* riding on top of an existing color (a gold-rimmed red still counts as red)? The modifier route preserves board readability.
- **Match shape.** Do you need 3 money gems in a row, or does matching *any* line containing a money gem yield gold? The latter rewards opportunism without forcing dedicated setup.
- **Drop pacing.** Should gold per encounter be roughly fixed (with player skill changing *when* not *how much*), or genuinely RNG-variable? Fixed feels fairer; variable creates highs.

### Variants worth prototyping
- **Coin gems** — straightforward: 7th color, dedicated match. Easiest to read, costs board real estate.
- **Gilded gems** — modifier on existing gems. ~10% of spawns gilded. Matching any line containing a gilded gem awards gold = number of gilded in the match. Doesn't dilute combat colors.
- **Treasure gem** — rare, single-tile pickup. Doesn't match like other gems; clears when any match touches it. Pure opportunism, no setup.
- **Vein gems** — money gems that *chain*: matching one auto-clears all adjacent money gems for compounding gold. Encourages saving them up for a big cash-out turn.

### Things to watch
- Money gems crowding out combat tiles → boards feel starved.
- Money gems being a no-brainer ("always match them first") → erodes the tactical choice.
- Gold inflation across a run → late-game shops trivialize themselves.

---

## Money Gems — Deeper Dive

### Reading against the locked design
Before picking a mechanic, a few constraints from `01-design.md` that should anchor the decision:

- **There are exactly 5 colors, each with a pool.** Adding a 6th tile-type would dilute every color's spawn share from 20% → ~16.7%, which is a real hit to the carefully tuned combat economy. **Implication:** money should ride *on top of* the 5 colors, not become a 6th.
- **4+ matches already "spawn special tile? (TBD)"** in the match-size table. There's already a designated hook for "good play spawns something extra" — money gems are the obvious candidate to fill that slot.
- **Cascade multipliers exist (×1 / ×1.5 / ×2 / ×3)** and already apply to all five pool deltas. Gold can plug into the same multiplier pipeline for free, so cascading is a unified scoring engine across combat *and* economy.
- **Existing gold target is ~10–20 per fight / 30–40 per elite.** Whatever the new mechanic does, the totals it produces have to land near these numbers, or shop economy needs re-tuning.
- **`onMatch` and `onCascade` hooks are already first-class.** Money is just another subscriber, not new infrastructure.

### Recommended baseline: **Gilded gems, spawned on 4+**

The cleanest hybrid given the constraints:

1. **Gilded is a modifier riding on a normal color** — a gilded red is still a red. Matching it advances the red pool *and* yields gold. No color dilution; no new match logic.
2. **Spawned in cascade-cleared voids by 4+ matches** — exactly the "special tile" slot already reserved in the design.
   - 4-match → 1 gilded gem drops into a void cell.
   - 5-line → 2 gilded.
   - T / L → 3 gilded.
   - Cascade chain → each tier-2+ cascade has its own roll (so big cascades genuinely rain gold).
3. **Color of the gilded drop is random across the 5 colors** — no skew. Player can't farm a specific pool by chasing gold.
4. **Gold credit on match: base 1 gold per gilded gem matched, multiplied by the active cascade multiplier.** A gilded matched during the 3rd cascade tier = 2 gold; in the 4th tier = 3. Floors the same way every other delta does (per the global rounding rule).

This makes gold a **bonus layered onto skilled play**, not a competing objective. The player isn't choosing "money or damage" each turn — they're choosing "do I extend this cascade for more gold even if it leaves the board worse for next turn?" That's a more interesting decision than "grab the shiny."

### Concrete numbers (starting points, not locked)

Per-fight gold target: **~12 normal, ~30 elite, ~50 boss**.

| Event | Gilded spawned | Notes |
|---|---|---|
| 4-match | 1 | Drops into cascade void |
| 5-line | 2 | |
| T/L | 3 | AOE matches already premium |
| Each cascade tier ≥2 | +1 | Cascade chains compound |

| Match of gilded | Gold (×cascade mult) |
|---|---|
| Single gilded in a 3-match | 1 × mult |
| 2 gilded in a 4-match | 2 × mult |
| All-gilded line (rare) | full count × mult |

Rough fight model:
- **Normal fight (~5 phases):** assume 2–3 4+ matches and 1 cascade chain → ~4–6 gilded spawned, ~80% harvested before fight ends → **~10–15 gold**. ✓
- **Elite fight (~8 phases):** more matches + bigger cascades from build maturity → **~25–35 gold**. ✓
- **Skill ceiling:** a great run with lots of 5-line and cascading could push 20+ on a normal fight. That's intentional headroom.

Shop costs (re-tuned for the new economy):

| Item | Cost |
|---|---|
| Heal (small, ~15% HP) | 6 |
| Heal (large, ~40% HP) | 14 |
| Reroll a reward offer | 5 |
| Pool-seed / move / glyph slot | 12–18 |
| Consumable (single-use combat aid) | 10 |
| Relic-remove | 20 |

(Relics themselves aren't in the shop in this proposal — they only come from elite/boss. Shop is for shaping the build, not relic gambling. This is a real divergence from the locked design and probably wants its own decision.)

### Where the tactical choice actually lives

Honest accounting of the "tactical choice" pitch — where does the decision *actually* surface?

1. **Cascade-length call.** Cascades that go long spawn more gilded but also fill the board with their drops, which can crowd what comes next. Sometimes the best damage swap doesn't maximize cascade — and *now* there's a third axis (gold) pulling on that decision.
2. **Spell timing around gilded.** A spell that clears a column might wipe out unharvested gilded. The player has to weigh "free damage column" vs "lose pending gold."
3. **Greed-vs-survival in low HP.** When dying, do you swap for the cluster that includes a gilded (slower kill, more gold) or the cluster that finishes the enemy now? This is the *Magpie's Hoard* relic territory — even without the relic, the tension exists.
4. **End-of-fight cleanup.** Unmatched gilded on the board when the fight ends are **lost** (boards reset). This pressures the player to harvest before the kill — and means rushing a kill is a real cost.

If those four pressures don't show up in playtest, the mechanic is just "free passive gold" and we should cut it.

### Telegraph & visibility
- Gilded gems need a clear visual: gold rim/glow on the base color, no shape change.
- A small floating "+N" gold popup on harvest, distinct color from the existing combat popups (per the locked popup font rule — Paytone One — and the existing verb-to-tile particle pipeline).
- HUD gold counter ticks up on every harvest. End-of-fight summary shows gold earned + gold left on board (regret signal — "you missed 3").

### Variants worth keeping in the back pocket
- **Vein gems** — when one gilded spawns, ~30% chance to spawn 2–3 adjacent. Encourages saving them up for a single big-cascade harvest. Feast-or-famine flavor.
- **Treasure gem** — rare special drop (~1 per fight) that doesn't match; clears when adjacent to any match. Pure opportunism, no setup. Could replace boss-fight gold drop.
- **Magpie mode (run modifier)** — gilded spawn rate +50%, enemy damage +1. A run-shaping toggle picked at the start of a run, not a per-fight thing.
- **Interest at shop** — Balatro-style, gain +1 gold per 5 saved. *Probably* premature; would push players to skip shops to bank, which we don't want for a 6–8 encounter run.

### Open questions
- Does unspent gold carry between acts? (Slice is single-act, so moot for v1.)
- Do relics like **Cascade Crystal** (+50% to 2nd+ cascade payouts) apply to *gold* deltas too, or just combat pools? Argue for "all pools, gold included" — keeps the multiplier rule uniform. But this means cascade-focused builds become *also* gold-focused, which may be a feature or a problem.
- Are there enemies that **damage gilded gems** (corrupt them, steal them, lock them)? Could be a flavorful counter-mechanic — a "Magpie" enemy archetype that takes gold off the board if not harvested in time.
- Does gold persist on death (run-end)? Probably no — gold is intra-run only.

---

## Enemy Rewards (Non-Money)

Split by encounter tier. Each tier owns a different time horizon.

### Normal encounters — "Pool & Moves"
**Goal:** shape *how the board plays*. Low individual impact, compounds across a run. Player picks 1 of 3 offered.

#### Pool seeds — gems added to the spawn pool
- **Loaded Die** — 1 wildcard "Joker" gem can appear per board; matches as any color.
- **Black Star** — rare void gems; matching eats orthogonal neighbors (board-nuke risk, cascade reward).
- **Twin Lodestone** — links two colors; matching one charges the other's cascade meter.
- **Cursed Ruby** — high-damage red gem, but cannot be cleared by spells (forces match-only solutions).
- **Mirror Shard** — duplicates the color of whatever it falls next to.
- **Tideglass** — every turn it sits on the board, it slowly shifts color through the spectrum.

#### Moves — player-activated board manipulations (charge-based, ~1 use per encounter)
- **Pivot** — swap any two non-adjacent gems.
- **Tide** — shift a whole row or column one tile.
- **Anneal** — recolor a 3×3 area to one chosen color.
- **Ember Sigil** — next match this turn applies Smolder.
- **Plumb** — drop a chosen gem straight down through everything.
- **Shatter** — destroy a single gem of choice; cascades resolve normally.

#### Glyphs — passive triggers tied to play patterns
- **Chainwarden** — every 4+ cascade, gain 1 armor.
- **Greedy Gut** — money gems also heal 1 when matched.
- **Slow Burn** — Smolder you apply lasts +1 turn.
- **Hot Streak** — three matches in a row of the same color buffs the next match's damage.
- **Sapper** — every 10th match this run triggers a free cascade.

### Elite encounters — "Relic + Choice"
**Goal:** mid-run power spike, real commitment. Always a relic, plus a secondary pick (heal / pool seed / move).

- **Cascade Crown** — every 4+ cascade grants a free move.
- **Dragon's Eye** — see the next 3 rows of gems queued to drop.
- **Phoenix Heart** — once per run, revive at 50% HP.
- **Crucible** — one chosen color now also applies Smolder on match.
- **Hourglass** — first move each combat is free (no enemy turn).
- **Magpie's Hoard** — money gems are worth +50%, but enemies hit +1.

### Boss encounters — "Run-defining"
**Goal:** climactic. Boss relic + guaranteed shop + path choice for next act.

- **Ouroboros** — on full board-clear, take 1 damage, gain 2 max HP.
- **Empty Throne** — start each combat with one column already cleared.
- **Astrolabe** — choose which color drops next (1×/encounter).
- **Worldroot** — pool seeds you've picked this run also affect future runs at reduced rate (meta-progression hook).

---

## Enemy Rewards — Deeper Dive

### A correction to the framing
The earlier sketch listed **three axes** for normal-encounter rewards: pool seeds, moves, and glyphs. Looking at it next to `01-design.md`, **glyphs collapse into relics**. Examples like *Chainwarden* ("every 4+ cascade, gain 1 armor") or *Slow Burn* ("Smolder lasts +1 turn") are functionally identical to the locked relic examples (Iron Buckler, Cascade Crystal, Thornmail) — same `onMatch` / `onCascade` hooks, same passive-trigger pattern.

If relics are reserved for elite/boss (the scarcity pitch), then normal encounters can't also drop relics-by-another-name. Splitting them into "small relics from normals, big relics from elites" undoes the scarcity. Pick one and commit.

**Real answer: there are two distinct normal-encounter axes — pool seeds and moves.** Each is a genuinely new system, not relics in disguise.

### Pool Seeds — the case for primary

Pool seeds modify *the board itself*, which is the heart of the game. A run with 4 seeds plays qualitatively differently from a run with 0. Every match is shaped by what's in the pool.

**Strengths**
- Hits the central verb (matching) more directly than any other reward type.
- Most novel — Bejeweled / Puzzle Quest don't really do this. "Deckbuilding for match-3" is unexplored territory.
- Compounds visibly. By the boss, the board *looks different* from a seedless run. That's identity.
- Re-uses the cell-flags primitive (Phase J1 corruptor work) — no new architecture.

**Risks**
- Cognitive load. Every added gem type increases color-counting complexity. Match-3 lives or dies on visual legibility.
- Hard to balance. A Joker (matches any color) is borderline broken; a Cursed Ruby (can't be cleared by spells) might be a trap. Wide power range.
- Cumulative reads on the board start to feel chaotic after ~4 seeds. Probably a hard cap.

### Moves — the case for primary

Moves are player-activated board manipulations earned as rewards. Verbs, not stats.

**Strengths**
- Player agency. "I had a Pivot and used it at the perfect moment" is a memorable beat. Pool seeds don't give those beats — they give a slow drift in board feel.
- Easier to balance individually. One effect, one cost, one charge.
- Lower cognitive load — moves sit in a UI slot, the board stays clean.
- Each move is a *story* the player can tell at run end.

**Risks**
- UI clutter alongside class spells (Bulwark, Reinforce, Riposte). The action surface is already non-trivial; adding 3 more buttons needs thought.
- "Spam when available" failure mode if balance is off.
- Tonal overlap with spells — at what point is a "move" just a temporary spell?

### Why offering BOTH is the right answer

The normal-encounter reward is a 1-of-3 pick. The pool of possible offers should include both seeds and moves (and maybe a third minor option — see below). The player's accumulated picks across a 4–5 normal-fight run become a **self-directing build axis**:

- **Pool-heavy run** (3–4 seeds, 0–1 moves): chaotic, high-variance, "alien board" identity. Best with relics that read board state.
- **Move-heavy run** (3 moves, 0–1 seeds): clean board, lots of agency, "toolbox" identity. Best with relics that trigger off spell-like actions.
- **Mixed** (2 seeds, 2 moves): default flavor, balanced.

This makes the reward-pick screen itself the most interesting strategic decision the player makes outside of combat — and it falls out for free from offering 1-of-3 across both axes.

### Tuning ideas

**Pool seeds**
- Hard cap: **4 seeds per run.** Beyond this, board reads degrade.
- Seeds *can include subtractions* — "remove yellow from the pool for the rest of the run, but spawn 1 extra red." A subtraction option keeps the cap-pressure manageable and creates real strategic choices.
- Common-tier seeds: small adjustments (slightly higher spawn of color X, rare wildcard at 1/board).
- Uncommon-tier seeds: structural changes (Twin Lodestone, Black Star).
- No rare-tier seeds in normal encounters (rare = relic territory).

**Moves**
- **Limited move slots: 3.** Once full, picking a new move means dropping one. Forced commitment = interesting choice every time.
- Per-encounter charges (refill at fight start). Not one-shot — anxiety over "saving the last Pivot" is high friction for a 6–8 encounter run.
- Most moves: 1 charge. Premium moves: 2 charges.
- UI: a small move tray *next to* the spell tray, not merged. Spells = class-locked / mana cost; Moves = run-acquired / charge-based. Different visual language.

**Offer composition (normal fight reward screen)**
- 3 picks shown.
- ~50% seeds, 40% moves, 10% subtraction/utility (e.g. "delete one of your moves and gain its uncommon-tier replacement," or "+1 max move slot").
- Skewed away from pure RNG — the offer should *usually* let the player commit to whichever axis they've been building.

### Where the choice lives

For pool seeds, the decision is **at the pick screen** ("is this seed worth the cognitive cost?") and almost never again — once picked, it just exists in the pool.

For moves, the decision is **constantly during combat** ("when do I burn this Tide?"). Higher engagement per encounter.

This asymmetry is interesting: pool seeds are a *thinking* reward (heavy decision once), moves are a *playing* reward (light decision many times). The mix of both gives normal encounters a varied texture.

### Open questions
- **Moves vs spells in the UI** — adjacent trays? Merged tray with type-icons? This is real UX work.
- **Move durability** — do moves persist across the run unchanged, or can they level up (charge++, effect++) at rest nodes? Levelling adds depth but also another decision surface.
- **Offer rerolls** — should the player be able to spend gold at the pick screen to reroll? Probably yes (5g, per the shop draft above) — keeps gold useful even outside the shop node.
- **What about pool seeds that change *during* a run?** A seed like "Tideglass" shifts color over turns. Cool, but might be too much. Park for v2.
- **Naming.** "Pool seeds" is descriptive but flavorless. *Echoes*? *Tinctures*? *Glints*? *Embers*? Worth a naming pass before any UI ships.

### Cut from consideration (for now)
- **Glyphs as a separate tier** — collapses into relics, breaks scarcity. Cut.
- **Encounter-keyed rewards** (specific enemies drop themed rewards à la Hades boons). Cool but multiplies content work by ~3×. Park for post-slice.
- **Gem upgrades** ("all reds now deal +1") — functionally a scoring relic. Use the relic system for this, not a new axis.

---

## Pressure-test priorities

1. **Money-gem spawn rules** — get the cadence right before anything else. Bad pacing here poisons every other reward decision.
2. **Pool-seed cap** — every gem type added makes color-counting harder. Probably need a hard cap (4–5 seeds per run?) or have seeds *replace* existing tiles rather than add to the pool.
3. **Moves are the most novel axis** — they read as "abilities" not "stats." Worth leaning into hardest; they also give normal encounters a strong, memorable identity.
4. **Reward overlap** — make sure money-buyable shop items don't duplicate what normal encounters reward, or normal encounters lose meaning.
