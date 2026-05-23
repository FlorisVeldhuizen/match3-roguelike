# Reward Ideas — Brainstorm

Status: exploratory. Not committed. Goal: pressure-test a hybrid economy where on-board money funds tactical choices, normal encounters shape *how the board plays* (via new gem types and moves), and relics (elite/boss only) shape *the whole run*.

**Terminology landed on:**
- **Gems** — additions to the spawn pool, won as normal-encounter rewards. Each is a concrete on-board gem type with its own art and rules. The player's run-specific "extra gems" sit on top of the always-present 5 base colors.
- **Moves** — player-activated, charge-based board manipulations, won as normal-encounter rewards.
- **Relics** — passive event-triggered effects, won from elite + boss only.
- **Gilded** — a gold-yielding modifier that rides on top of existing colored gems. The on-board source of money.

---

## Money Gems

### Core idea
Gold-yielding tiles on the board, harvested by matching. Gold is spent between encounters (shop, heals, rerolls). Makes economy a *tactical* choice during combat — "do I extend this cascade for more gold even if it leaves the board worse for next turn?"

### Open design questions
- **Spawn source.** Spawn only on cascades, never on initial board fill? This keeps money out of the way until the player earns the chance at it, and avoids diluting combat tiles in early-turn boards.
- **Tile identity.** Is money a new gem type (competes for matches with combat colors) or a *modifier* riding on top of an existing color (a gold-rimmed red still counts as red)? The modifier route preserves board readability.
- **Match shape.** Do you need 3 money tiles in a row, or does matching *any* line containing a money tile yield gold? The latter rewards opportunism without forcing dedicated setup.
- **Drop pacing.** Should gold per encounter be roughly fixed (with player skill changing *when* not *how much*), or genuinely RNG-variable? Fixed feels fairer; variable creates highs.

### Variants worth prototyping
- **Coin tile** — straightforward new tile type with dedicated matches. Easiest to read, costs board real estate, breaks the 5-color economy.
- **Gilded modifier** — modifier on existing gems. ~10% of spawns gilded. Matching any line containing a gilded tile awards gold = number of gilded in the match. Doesn't dilute combat colors. **(Recommended — see deeper dive.)**
- **Treasure tile** — rare, single-tile pickup. Doesn't match like other gems; clears when any match touches it. Pure opportunism, no setup.
- **Vein tiles** — money tiles that *chain*: matching one auto-clears all adjacent money tiles for compounding gold. Encourages saving them up for a big cash-out turn.

### Things to watch
- Money tiles crowding out combat colors → boards feel starved.
- Money matches being a no-brainer ("always match them first") → erodes the tactical choice.
- Gold inflation across a run → late-game shops trivialize themselves.

---

## Money Gems — Deeper Dive

### Reading against the locked design
Before picking a mechanic, a few constraints from `01-design.md` that should anchor the decision:

- **There are exactly 5 colors, each with a pool.** Adding a 6th tile-type would dilute every color's spawn share from 20% → ~16.7%, which is a real hit to the carefully tuned combat economy. **Implication:** money should ride *on top of* the 5 colors, not become a 6th.
- **4+ matches already "spawn special tile? (TBD)"** in the match-size table. There's already a designated hook for "good play spawns something extra" — money tiles are the obvious candidate to fill that slot.
- **Cascade multipliers exist (×1 / ×1.5 / ×2 / ×3)** and already apply to all five pool deltas. Gold can plug into the same multiplier pipeline for free, so cascading is a unified scoring engine across combat *and* economy.
- **Existing gold target is ~10–20 per fight / 30–40 per elite.** Whatever the new mechanic does, the totals it produces have to land near these numbers, or shop economy needs re-tuning.
- **`onMatch` and `onCascade` hooks are already first-class.** Money is just another subscriber, not new infrastructure.

### Recommended baseline: **Gilded gems, spawned on 4+**

The cleanest hybrid given the constraints:

1. **Gilded is a modifier riding on a normal color** — a gilded red is still a red. Matching it advances the red pool *and* yields gold. No color dilution; no new match logic.
2. **Spawned in cascade-cleared voids by 4+ matches** — exactly the "special tile" slot already reserved in the design.
   - 4-match → 1 gilded tile drops into a void cell.
   - 5-line → 2 gilded.
   - T / L → 3 gilded.
   - Cascade chain → each tier-2+ cascade has its own roll (so big cascades genuinely rain gold).
3. **Color of the gilded drop is random across the 5 colors** — no skew. Player can't farm a specific pool by chasing gold.
4. **Gold credit on match: base 1 gold per gilded tile matched, multiplied by the active cascade multiplier.** A gilded matched during the 3rd cascade tier = 2 gold; in the 4th tier = 3. Floors the same way every other delta does (per the global rounding rule).

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
| Gem / move (common–rare) | 12–25 |
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
- **Vein gilded** — when one gilded spawns, ~30% chance to spawn 2–3 adjacent. Encourages saving them up for a single big-cascade harvest. Feast-or-famine flavor.
- **Treasure tile** — rare special drop (~1 per fight) that doesn't match; clears when adjacent to any match. Pure opportunism, no setup. Could replace boss-fight gold drop.
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

### Normal encounters — "Gems & Moves"
**Goal:** shape *how the board plays*. Low individual impact, compounds across a run. Player picks 1 of 3 offered.

#### Gems — new gem types added to the spawn pool
Every gem reward unlocks a concrete new on-board gem type with its own art, spawn rules, and match behavior. No abstract reweights or invisible color-couplings — if the player picked it, they should see it.

- **Loaded Die** — a "Joker" gem that matches as any color; 1 per board.
- **Black Star** — rare void gems; matching eats orthogonal neighbors (board-nuke risk, cascade reward).
- **Twin Lodestone** — a special gem that, when matched, also advances a linked color's pool (color chosen at pickup).
- **Cursed Gem** — high-damage gem, but cannot be cleared by spells (forces match-only solutions).
- **Mirror Shard** — copies the color of whichever gem it lands next to.
- **Tideglass** — every turn it sits on the board, it slowly shifts color through the spectrum.

#### Moves — player-activated board manipulations (charge-based, ~1 use per encounter)
- **Pivot** — swap any two non-adjacent gems.
- **Tide** — shift a whole row or column one tile.
- **Anneal** — recolor a 3×3 area to one chosen color.
- **Ember Sigil** — next match this turn applies Smolder.
- **Plumb** — drop a chosen gem straight down through everything.
- **Shatter** — destroy a single gem of choice; cascades resolve normally.

#### Glyphs — passive triggers tied to play patterns
*(Sketch only — cut on the next pass; see "A correction to the framing" below.)*
- **Chainwarden** — every 4+ cascade, gain 1 armor.
- **Greedy Gut** — gilded gems also heal 1 when matched.
- **Slow Burn** — Smolder you apply lasts +1 turn.

### Elite encounters — "Relic + Choice"
**Goal:** mid-run power spike, real commitment. Always a relic, plus a secondary pick (heal / gem / move).

- **Cascade Crown** — every 4+ cascade grants a free move.
- **Dragon's Eye** — see the next 3 rows of gems queued to drop.
- **Phoenix Heart** — once per run, revive at 50% HP.
- **Crucible** — one chosen color now also applies Smolder on match.
- **Hourglass** — first move each combat is free (no enemy turn).
- **Magpie's Hoard** — gilded gems are worth +50%, but enemies hit +1.

### Boss encounters — "Run-defining"
**Goal:** climactic. Boss relic + guaranteed shop + path choice for next act.

- **Ouroboros** — on full board-clear, take 1 damage, gain 2 max HP.
- **Empty Throne** — start each combat with one column already cleared.
- **Astrolabe** — choose which color drops next (1×/encounter).
- **Worldroot** — gems you've picked this run also affect future runs at reduced rate (meta-progression hook).

---

## Enemy Rewards — Deeper Dive

### A correction to the framing
The earlier sketch listed **three axes** for normal-encounter rewards: gems, moves, and glyphs. Looking at it next to `01-design.md`, **glyphs collapse into relics**. Examples like *Chainwarden* ("every 4+ cascade, gain 1 armor") or *Slow Burn* ("Smolder lasts +1 turn") are functionally identical to the locked relic examples (Iron Buckler, Cascade Crystal, Thornmail) — same `onMatch` / `onCascade` hooks, same passive-trigger pattern.

If relics are reserved for elite/boss (the scarcity pitch), then normal encounters can't also drop relics-by-another-name. Splitting them into "small relics from normals, big relics from elites" undoes the scarcity. Pick one and commit.

**Real answer: there are two distinct normal-encounter axes — gems and moves.** Each is a genuinely new system, not relics in disguise.

### How the three axes layer

| Axis | Layer | Trigger | Source |
|---|---|---|---|
| **Relics** | Modifies game *outputs* (scoring, damage, healing) | Event-driven (`onMatch`, `onCascade`, …) | Elite + boss only |
| **Moves** | Modifies game *state* (board contents) | Player-activated | Normal encounters |
| **Gems** | Modifies game *inputs* (spawn pool) | Always-on, passive | Normal encounters |

Gems are the only reward type that changes what appears on the board *before* the player does anything. Relics react to play; moves disrupt play; gems shape the play environment itself.

### Gems — the case for primary

A run with 4 extra gem types plays qualitatively differently from a run with 0. Every match is shaped by what's in the pool.

**Strengths**
- Hits the central verb (matching) more directly than any other reward type.
- Most novel — Bejeweled / Puzzle Quest don't really do this. "Deckbuilding for match-3" is unexplored territory.
- Compounds visibly. By the boss, the board *looks different* from a gemless run. That's identity.
- Re-uses the cell-flags primitive (Phase J1 corruptor work) — no new architecture.

**Risks**
- Cognitive load. Every added gem type increases color-counting complexity. Match-3 lives or dies on visual legibility.
- Hard to balance. A Joker (matches any color) is borderline broken; a Cursed Gem (can't be cleared by spells) might be a trap. Wide power range.
- Cumulative reads on the board start to feel chaotic after ~4 extras. Hard cap.

### Moves — the case for primary

Moves are player-activated board manipulations earned as rewards. Verbs, not stats.

**Strengths**
- Player agency. "I had a Pivot and used it at the perfect moment" is a memorable beat. Gems don't give those beats — they give a slow drift in board feel.
- Easier to balance individually. One effect, one cost, one charge.
- Lower cognitive load — moves sit in a UI slot, the board stays clean.
- Each move is a *story* the player can tell at run end.

**Risks**
- UI clutter alongside class spells (Bulwark, Reinforce, Riposte). The action surface is already non-trivial; adding 3 more buttons needs thought.
- "Spam when available" failure mode if balance is off.
- Tonal overlap with spells — at what point is a "move" just a temporary spell?

### Why offering BOTH is the right answer

The normal-encounter reward is a 1-of-3 pick. The pool of possible offers should include both gems and moves (and maybe a third minor utility option — see below). The player's accumulated picks across a 4–5 normal-fight run become a **self-directing build axis**:

- **Pool-heavy run** (3–4 gems, 0–1 moves): chaotic, high-variance, "alien board" identity. Best with relics that read board state.
- **Move-heavy run** (3 moves, 0–1 gems): clean board, lots of agency, "toolbox" identity. Best with relics that trigger off spell-like actions.
- **Mixed** (2 gems, 2 moves): default flavor, balanced.

This makes the reward-pick screen itself the most interesting strategic decision the player makes outside of combat — and it falls out for free from offering 1-of-3 across both axes.

### Tuning ideas

**Gems**
- **Hard cap: max 4 special gems in your pool.** Beyond this, board reads degrade.
- Picks can include **subtractions** — "remove one of your gems from the pool" or "swap one of your gems for an offered alternative." Subtractions keep the cap-pressure manageable and create real strategic choices.
- Common-tier gems: low-frequency types with simple rules (rare wildcard at 1/board, gentle helper).
- Uncommon-tier gems: structural new types (Twin Lodestone, Black Star).
- No rare-tier gems in normal encounters (rare = relic territory).

**Moves**
- **Limited move slots: 3.** Once full, picking a new move means dropping one. Forced commitment = interesting choice every time.
- Per-encounter charges (refill at fight start). Not one-shot — anxiety over "saving the last Pivot" is high friction for a 6–8 encounter run.
- Most moves: 1 charge. Premium moves: 2 charges.
- UI: a small move tray *next to* the spell tray, not merged. Spells = class-locked / mana cost; Moves = run-acquired / charge-based. Different visual language.

**Offer composition (normal fight reward screen)**
- 3 picks shown.
- ~50% gems, 40% moves, 10% utility (e.g. "subtract a gem and gain a fresh pick," "+1 max move slot," "+1 charge to an existing move").
- When a category is at cap (gems 4/4 or moves 3/3), offers from that category are replaced by utility or the other category. Player is never shown a useless option.

### Where the choice lives

For gems, the decision is **at the pick screen** ("is this gem worth the cognitive cost?") and almost never again — once picked, it just exists in the pool.

For moves, the decision is **constantly during combat** ("when do I burn this Tide?"). Higher engagement per encounter.

This asymmetry is interesting: gems are a *thinking* reward (heavy decision once, then ambient), moves are a *playing* reward (light decision many times). The mix of both gives normal encounters a varied texture.

### Open questions
- **Moves vs spells in the UI** — adjacent trays? Merged tray with type-icons? This is real UX work.
- **Move durability** — do moves persist across the run unchanged, or can they level up (charge++, effect++) at rest nodes? Levelling adds depth but also another decision surface.
- **Offer rerolls** — should the player be able to spend gold at the pick screen to reroll? Probably yes (5g, per the shop draft below) — keeps gold useful even outside the shop node.
- **Gems that change *during* a run?** Tideglass shifts color over turns. Cool but possibly too much. Park for v2.

### Cut from consideration (for now)
- **Glyphs as a separate tier** — collapses into relics, breaks scarcity. Cut.
- **Spawn-weight reweights** ("Crimson: +8% red spawn") — abstract and invisible to the player; not legibly different from "free passive buff." Cut. Every gem reward must manifest as a concrete on-board tile.
- **Invisible color-links** (the original Twin Lodestone "couples two colors") — reframed as a concrete gem tile that does the linking when matched.
- **Encounter-keyed rewards** (specific enemies drop themed rewards à la Hades boons). Cool but multiplies content work by ~3×. Park for post-slice.
- **Gem upgrades** ("all reds now deal +1") — functionally a scoring relic. Use the relic system for this, not a new axis.

---

## Reward Screen UX

### What the screen has to do
After each normal encounter, the player picks 1-of-3 from a mixed offer of gems, moves, and utility. Key job-to-be-done: **let the player make a build-shaping decision in 5–15 seconds without calculation.**

Specifically the screen needs to:
1. Show three offered options with enough info to choose.
2. Show *current build state* — owned gems, move slots, owned relics — without forcing a separate inventory check.
3. Make synergies visible. ("This gem matches your *Cascade Crystal*.")
4. Handle slot-full cases (gems 4/4 or moves 3/3) gracefully.
5. Offer reroll + skip without making them feel like the optimal play.

### Proposed layout

```
┌────────────────────────────────────────────────────────────────┐
│  Relics: [🛡] [💎] [🌀]                          Gold: 23  [↻5]│
├────────────────────────────────────────────────────────────────┤
│                                                                │
│      ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│      │   GEM    │    │  MOVE    │    │ UTILITY  │              │
│      │ Loaded   │    │  Pivot   │    │  Forge   │              │
│      │  Die     │    │          │    │          │              │
│      │          │    │ swap any │    │ +1 move  │              │
│      │ 1 joker/ │    │ 2 gems   │    │  slot    │              │
│      │  board   │    │ 1×/fight │    │          │              │
│      │ ★common  │    │ ★uncommon│    │  ★rare   │              │
│      └──────────┘    └──────────┘    └──────────┘              │
│                                                                │
├────────────────────────────────────────────────────────────────┤
│ Gems: [gem1] [gem2] [__] [__]    Moves: [Tide] [__] [__]       │
│                                                       [Skip→]  │
└────────────────────────────────────────────────────────────────┘
```

- **Top strip:** relics (synergy reads), gold, reroll button.
- **Center:** 3 offer cards with rarity glow, type tag, name, short effect line.
- **Bottom strip:** current gems (4 slots visible, empty cells obvious), current moves (3 slots), Skip.

Skip is small and unaccented — present but not advertised. Probably gives a *tiny* gold bonus (~3) so it's a real option for cognitive-load reasons but never the optimal economic choice.

### Card detail on hover/focus
Hovering a gem card shows a **mini board preview** — a 4×4 illustrative grid demonstrating the gem's behavior (a Joker tile flashing color cycles; a Black Star with its neighbor-eat animation). Worth the implementation cost: new gems are abstract until you see them act.

Hovering a move card shows the **before/after board state** for the move's effect.

Hovering a utility card shows plain text — utility doesn't need motion.

### Slot-full handling
When all 3 move slots are filled and the player picks a 4th move:
- A secondary panel slides in showing the 3 current moves.
- Player clicks one to drop. That move is **gone** (not refunded, not stashed).
- Confirm step before commit — this is destructive.

For gems at cap (4/4), the offer pool **stops offering new gems** until a subtraction or a swap utility appears. The screen shouldn't present a "drop a gem" flow — gems are meant to be a *commitment*, not a rotating inventory. Subtractions are deliberate gold purchases or utility picks, not impulsive drops.

### Reroll mechanic
- Cost: **5 gold** for a single full reroll of all 3 offers.
- Limit: **1 reroll per screen.** Multiple rerolls degenerate into "play until you see the rare you wanted."
- The reroll button visibly disables after use.

### What's deliberately *not* on the screen
- HP / Max HP — already in the persistent HUD.
- Class spells — these don't change between encounters; no need to re-show.
- Enemy threat preview for the next encounter — adds a meta-strategy layer that's interesting but probably too much. Park for v2.

### Open UX questions
- **Synergy highlights** — should cards visibly glow when they synergize with an owned relic? Tempting (helps decisions) but risks turning every pick into "the glowing one." Maybe a subtle indicator (small relic icon on the card corner) rather than a full glow.
- **Mid-cascade preview** — if the player picks a gem, should the next encounter's *first board* immediately demo it? Probably yes — first-impression matters for whether the pick felt good.
- **Pace** — does the screen auto-advance after a delay, or wait indefinitely? Wait indefinitely. Cognitive load is high; rushing breaks the decision.

---

## Shop Economy (revised)

### What changed
Per `01-design.md`, the original shop carried: 3 relics, 2 heals, 1 relic-remove, 1 board-upgrade. With relics pulled to elite/boss only, the shop loses its headline item. It needs new inventory that's still worth detouring for — otherwise the shop node becomes a heal-only stop that the player avoids when at full HP.

### Proposed shop inventory (per visit)

| Slot | Item | Cost (gold) | Always offered? |
|---|---|---|---|
| 1–3 | Gems (random, 1 each) | 12 / 18 / 25 (by rarity) | Yes, 3 of them |
| 4–5 | Moves (random, 1 each) | 12 / 18 / 25 (by rarity) | Yes, 2 of them |
| 6 | Small heal (~15% HP) | 6 | Yes |
| 7 | Large heal (~40% HP) | 14 | Yes |
| 8 | Gem subtraction (remove one of your gems) | 8 | Yes |
| 9 | Relic-remove | 25 | Yes |
| — | Shop reroll (refresh gems + moves) | 10 | Yes (1×/visit) |

Nine slots, four of them random (gems + moves), five fixed utility. The fixed slots make the shop predictable enough to *plan around* ("I'll save 14g for the big heal at the next shop"); the random slots keep it varied.

### Gold flow check
Run-wide gold targets, per the money-gem deeper dive:
- ~4 normal fights × 12 = **48**
- 1 elite × 30 = **30**
- 1 boss × 50 = **50** (mostly wasted in v1 — boss is end of slice)
- **Total spendable: ~80 gold across 1–2 shop visits.**

Per shop visit: ~40–80 gold available. Player can buy 2–4 items. That feels right — meaningful choice, can't buy everything.

A skilled-play run pushes spendable gold to ~110–140 (more 4+ matches, more cascades, more gilded harvest). The shop should *not* let the player buy out the entire inventory at the high end — that means item prices need to stay slightly above what a mediocre run can comfortably cover. The 25-gold rare-tier prices are the throttle.

### What about relics in the shop?
Tempting compromise: occasionally offer a single relic in the shop (maybe 1 in 3 shop visits, common-tier only). Argument for: keeps the shop exciting. Argument against: erodes the elite/boss scarcity that was the whole point of the new structure.

**Recommendation: no relics in shop, ever.** Commit to the new structure. Elite/boss is the only source. If the shop feels thin without relics in playtest, *then* revisit — but starting from "shop has relics" undoes the design pivot before it's tested.

### Rest nodes (also need rework)
Locked design: rest = heal 30% OR upgrade a relic. With relics elite/boss-only, "upgrade a relic" doesn't apply until the player has at least one — so early-run rest nodes effectively only offer heal.

Proposed rest-node options:
- **Heal** — 30% HP. Always available.
- **Sharpen a move** — pick one of your moves; gain +1 charge OR upgrade its effect (predefined upgrade path per move). Available if you own moves.
- **Retune the pool** — pick one of your gems; reroll it to a same-rarity alternative. Available if you own gems.
- **Upgrade a relic** — keeps the original locked-design option. Available only if you own a relic.

The first rest is usually a heal. Later rests, once the player has built up moves/gems/relics, the choice becomes interesting.

### Open questions on shop & rest
- **Shop reroll cost** — 10 gold once per visit. Should this scale (10 / 20 / 40) or stay flat? Flat is simpler; scale is more StS-faithful. Leaning flat.
- **Are unsold items returned to a future shop?** No — keep it simple. Each shop is fresh.
- **Can you sell items back to the shop?** No. Selling-back is a system tax (UI, balance, abuse paths) for marginal payoff in a 6–8 encounter run.
- **Bulk-buy discount?** No. Encourages hoarding-then-blowing-it-all in the last shop, which we don't want.
- **Should the boss drop gold at all?** Probably not in v1 (slice ends, no use), but flagging because it's a tuning lever for later acts.

---

## Initial Content List

A first pass at the content needed to actually playtest the system. Not balanced yet — these are *design candidates* meant to span the space and surface gaps. Aim: ~10 gems + ~10 moves + a small utility pool. Roughly enough to fill 4–5 normal-encounter reward screens per run with varied offers.

### Gems

Spread across two rarity tiers. Common gems have small, clear effects and spawn at higher rate when in the pool; uncommon gems have structural effects and spawn rarely.

| Name | Rarity | Effect | What it tests |
|---|---|---|---|
| **Loaded Die** | Common | A "Joker" gem that matches as any color. 1 per board. | The wildcard fantasy. Matching flexibility without consequence — likely the most-picked gem unless tuned carefully. |
| **Mirror Shard** | Common | When it drops into a cell, copies the color of the gem directly below or adjacent. | Drop-time emergence. Plays differently depending on what's below it. |
| **Ember** | Common | When matched, also applies 1 Smolder to the targeted enemy, regardless of color. | Status-build synergy. Pairs with Crucible / Slow Burn relics. |
| **Splinter** | Common | When matched, spawns 1 extra gem of the same color in a random empty cell as the cascade resolves. | Cascade engine. Compounds with cascade-multiplier relics. |
| **Black Star** | Uncommon | When matched, also destroys the 4 orthogonal neighbors (they count toward their colors' pools). | High-risk explosive play. Trades board chaos for big payoff. |
| **Twin Lodestone** | Uncommon | At pickup, link two colors. When this gem is matched, the *linked* color's pool also gains the match value. | Cross-color economy. Lets the player build engines around a favored color. |
| **Cursed Gem** | Uncommon | Deals +50% damage when matched in red lines, but cannot be cleared by spells or moves — only by matching. | Forces match-only solutions. Creates "puzzle pressure" boards. |
| **Anchor** | Uncommon | Does not fall during cascades — sits in place until matched. Other gems flow around it. | Board-control. Becomes a fixed reference point the player builds around. |
| **Prism** | Uncommon | At match time, the player picks which color it counts as. | Pure flexibility. Tests whether universal tools feel exciting or just dilute identity. |
| **Tideglass** | Uncommon | Each turn it sits on the board unmatched, shifts to the next color in the spectrum. | Time pressure on the board itself. Risky — may be too disruptive; park as v2 candidate. |

**Design buckets covered:** wildcard utility (Loaded Die, Prism), drop-time emergence (Mirror Shard), status synergy (Ember), cascade engine (Splinter, Black Star), cross-color economy (Twin Lodestone), high-stakes damage (Cursed Gem), board control (Anchor), time pressure (Tideglass).

**Gaps to consider for v2:** a gem that interacts with *enemy* board verbs (cleanses cursed cells?); a gem that benefits from being *not* matched (gold accrual over turns?); a gem with multi-turn windup (charge up over 3 turns, big payoff).

### Moves

Spread across common, uncommon, and rare. Most moves are 1 charge per encounter; premium moves are 2 charges or have outsized effects.

| Name | Rarity | Charges | Effect | What it tests |
|---|---|---|---|---|
| **Pivot** | Common | 1 | Swap any two non-adjacent gems. | Surgical fix. Lowest-skill-ceiling move; mainstay of clean play. |
| **Tide** | Common | 1 | Shift a whole row or column one cell. Cells that fall off wrap to the other side. | Mass board reorientation. Sets up matches you couldn't reach. |
| **Ember Sigil** | Common | 1 | Next match this phase also applies 1 Smolder. | Status combo. Cheap setup for burn-focused runs. |
| **Spin** | Common | 1 | Rotate a 2×2 block of gems 90° clockwise. | Compact rearrangement; good for clearing tight knots. |
| **Lens** | Common | 1 | Preview the next 2 rows of gems queued to drop above a chosen column. | Information advantage. Tests whether peek-ahead changes how players plan. |
| **Anneal** | Uncommon | 1 | Recolor a 3×3 area to one chosen color. | Heavy reshape. Saves blown-out boards. |
| **Shatter** | Uncommon | 1 | Destroy a single gem; cascade resolves from the void. | Surgical removal. Cleans cursed cells, opens specific lines. |
| **Conjure** | Uncommon | 1 | Place a chosen-color gem into an empty cell during a cascade. | Pure board authoring. Mid-cascade interaction — implementation-heavy but huge tactical depth. |
| **Surge** | Uncommon | 1 | Convert 3 random gems on the board to one chosen color. | RNG-flavored color shift. Cheaper than Anneal but messier. |
| **Dust** | Rare | 1 | Remove all gems of one chosen color from the board. They count toward that color's pool. | Build-defining swing move. Probably the single most powerful normal-encounter reward — caps the move power curve. |

**Design buckets covered:** surgical fix (Pivot, Shatter), mass reshape (Tide, Anneal, Surge), compact rearrangement (Spin), information (Lens), status combo (Ember Sigil), authoring (Conjure), nuclear option (Dust).

**Gaps to consider for v2:** a move that interacts with enemy state (debuff / steal a buff); a move that *reverses* the last swap (undo as a deliberate resource); a "shelved swap" move that banks a planned action across phases.

### Utility picks

The 10% of offers that aren't gems or moves. These keep the reward screen flexible at category caps and provide non-power options.

| Name | Effect |
|---|---|
| **Forge** | +1 max move slot (one-time, hard cap at 4 total). |
| **Whetstone** | +1 charge to a chosen move you already own. |
| **Purge** | Subtract one of your gems from the pool. |
| **Trade** | Swap one of your gems for an offered alternative of the same rarity. |
| **Insight** | Free reroll on your next reward screen. |
| **Bounty** | +8 gold. Consolation pick when nothing else fits. |

### What the content list reveals

- **The gem list leans cognitively heavy.** Even with the 4-gem cap, a run with Loaded Die + Cursed Gem + Anchor + Tideglass is a board where multiple unusual rules are active simultaneously. Worth a playtest before deciding whether to soften (lower cap to 3? simpler effects?).
- **The move list is verb-rich.** Every move has a distinct on-board manifestation; no two feel interchangeable. This is the bucket where the design is healthiest.
- **Utility picks are thin.** Six options is probably right for first playtest — fewer would feel sparse, more would dilute the gem/move spotlight.
- **No gem currently interacts with enemy board verbs.** Worth filling that gap once Phase J1 lands and the corruptor verb is the reference. A "Cleanse Crystal" gem that purges cursed cells when matched would be a natural pickup.
- **No move currently interacts with the spell tray.** Possibly fine (keeps the move/spell separation clean), but flag it — once the spell system is more populated, "moves that empower spells" might be a worthwhile axis.

### Content scope for first playtest
- **10 gems** — fully implemented (art, spawn logic, match logic).
- **10 moves** — fully implemented (UI button, charge state, effect).
- **6 utilities** — text-only first pass; art polish post-playtest.

That's the minimum content surface to feel the full normal-encounter loop. Anything less and the reward screen recycles too obviously across a single run.

---

## Map & Path Interaction

The locked map (`01-design.md`) is a 6–8 node branching graph with 3 columns, 2–3 nodes per column, and 5 node types (Fight, Elite, Shop, Rest, Boss). The new economy doesn't require the map to *change* — but it does reshape what path choice means, which is worth working through.

### What changed about path-choice meaning

**Under the old design** (relic from every fight + gold from every fight):
- Fight = power. Elite = bigger power. Shop = power + gold-spend. Rest = sustain.
- Path choice was mostly "how much risk for how much power."

**Under the new economy**:
- Fight = build-shaping *gem-or-move* pick + small gold. No relic.
- Elite = relic + secondary pick. The only normal-source of relics.
- Shop = build customization. The only place to *target-buy* what RNG didn't offer.
- Rest = move sharpening / gem retuning / heal. Becomes valuable later in the run.

The shift: path choice is now less "risk vs power" and more "**how do I shape my build trajectory?**" — because every node type now feeds a different axis of the build. The map structure stays the same; its meaning gets deeper for free.

### Build-trajectory archetypes the map should support

These are the play patterns the new economy makes available. Each should be *distinguishable* on the map by node selection — if every archetype takes the same path, the system is broken.

| Archetype | Preferred path | What it builds |
|---|---|---|
| **Greedy** | Fight-heavy, then a shop | Stack gilded harvests, target-buy specific gems at shop. Trades pacing for build control. |
| **Restful** | Mix of fights + 2 rests | Smaller arsenal but upgraded — sharpened moves, retuned gems. Trades acquisition for refinement. |
| **Aggressive** | Detour through every elite | Relic-stacked. Trades HP for run-defining passives. |
| **Balanced** | Default: 4 fights, 1 elite, 1 shop, 1 rest | Some of everything; no committed axis. |

For these to be real choices, the map needs enough non-fight nodes that the player can *commit* to one. With only 1–2 special nodes (1 shop + 1 rest) in a 6–8 encounter run, the Restful and Greedy archetypes lose teeth — there isn't enough special-node density to express the preference.

### Recommended map adjustments

Small tweaks, not a rework:

1. **Bump shop+rest density to 3 total** in a 6–8 encounter run (e.g., 1 shop + 2 rests, or 2 shops + 1 rest). The previous design implied 1–2; bumping to 3 makes archetype paths viable.
2. **Move the guaranteed boss shop to *pre*-boss**, not post-. Boss is end-of-slice, so post-boss gold is wasted; pre-boss shop lets the player kit up for the final fight. This is a small change with a big payoff in spending tension across the run.
3. **Display rest-node options on the map**, not on arrival. Players need to know "this rest can sharpen a move" before they commit to that path. Otherwise pathing decisions are made on incomplete info.
4. **Keep the full map visible from start.** 6–8 nodes is small enough to scan; hiding it adds tension that the slice doesn't benefit from. (StS hides distant nodes because acts are 15+ rooms; ours doesn't have that scale.)

### Gold-flow shape across the run

Under the new economy, gold accumulates with a specific curve:

- **Early run (encounters 1–2):** ~24 gold. No build to spend on. Heals are the only useful purchase.
- **Mid run (encounters 3–5):** ~50–60 gold. Build identity forming. First shop is a real decision moment — target-buy a specific gem or move, or hoard for the pre-boss shop?
- **Pre-boss (encounters 6–7):** ~80+ gold. Identity solid. The pre-boss shop is a *targeted* buy — "I need exactly *this* to beat the boss intent."

This shape — slow then fast then targeted — wants **two shops minimum** (one mid-run, one pre-boss). With only one shop, the mid-run decision moment doesn't exist and players just hoard everything for pre-boss.

### Things to test in playtest

1. **Do players actually pick different paths based on build identity, or does optimal play converge?** If everyone picks the same path regardless of run state, the archetypes are decorative.
2. **Do runs end up visibly different?** Two players who picked different archetypes should be able to describe their runs in different language ("I went deep on gems" vs "I had Pivot at 3 charges by the boss").
3. **Is the boss achievable from any archetype?** If pool-heavy builds collapse at the boss because they can't burst-damage, that's an archetype that doesn't work yet.
4. **Does the pre-boss shop feel like a climactic moment?** It should. If players walk in with 80 gold and walk out with 3 items they didn't really need, the shop economy isn't doing its job.

### Open questions

- **Merchant caravan events** — a low-friction node type that's a partial shop (1–2 items, slight markup). Adds path variety without committing to a full shop. Maybe replace one fight per run with a caravan to test.
- **Predetermined vs randomized rest options** — should a rest node *show* on the map what it offers (Heal / Sharpen / Retune / Upgrade), or be random at arrival? Predetermined makes paths more strategic; random makes encounters more surprising. Probably predetermined for the slice.
- **Elite-or-fight choice nodes** — a single node that lets the player *opt in* to elite difficulty for the relic. Lower friction than committing a whole path to an elite. Probably too much for v1.
- **Gold-rush fights** — specific enemies that drop bonus gold on kill. Could differentiate fight nodes (e.g., a "Gilded Mob" node icon that telegraphs the gold-heavy fight ahead). Park as a v2 differentiator.
- **Gold persistence on death** — if gold is lost on run-end, players over-spend "before they die"; if it carries to next run, they hoard. For the slice (single-run scope), moot — gold dies with the run.

### What this section does *not* recommend

- **Changing the map structure** (column count, branching depth). The locked structure works; the economy gives it new meaning without needing a redesign.
- **Adding new node types beyond Caravan candidate**. The five existing types (+ optional Caravan) cover all the build-trajectory archetypes.
- **Procedural map generation per run.** The slice is too short to benefit; fixed maps with different start positions would playtest faster.

---

## Roadmap Integration

### Where we are
Phase G is complete (relic engine + first 5 relics + 1-of-3 relic reward screen). Phase H1 (map + run flow + single-enemy fights) is next. The current slice plan ends with 20 relics, relics-from-every-fight, and shop-sells-relics — i.e. the *original* economy, not the hybrid sketched in this doc.

### The honest framing
This doc is a **design pivot**, not an additive. Adopting it touches multiple already-planned phases (H1's reward screen, I's shop, J2's content fill) and adds new systems (gilded engine, gem registry, move engine + UI). It's not free; pretending it is would mislead the scoping.

The pivot's value also depends on something we don't know yet: whether the *current* design feels good in playtest. The original "relic from every fight" loop hasn't been proven thin or boring — it's just been imagined. If we pivot before playing the locked design, we're committing to a redesign based on intuition, not on observed friction.

### Two paths

**Path A — Finish the slice first, pivot later (recommended).**
Ship H1 → L as locked. Play a real run end-to-end. Use what that playtest teaches to decide whether the hybrid is worth the cost. If yes, treat the hybrid as a v2 milestone (M1–M6 sketch below). If no, you saved a meaningful amount of work and you have a published slice.

**Path B — Pivot now.**
Pause H1, fold the new economy into the slice. Adds ~3 new phases of work and forces revisions of H1, I, and J2. Higher risk (untested ideas baked into the first ship) but a more distinctive slice if it lands.

### Recommendation: **Path A**, but cherry-pick gilded.

The gilded mechanic is the most *additive* of the new ideas — it slots cleanly into the 4+ "special tile" slot already reserved in `01-design.md`, uses existing cascade/multiplier infrastructure, and doesn't replace any existing system. **Gilded could be added to Phase G or as a small Phase G.5 detour** without disrupting H1 onward.

Everything else (gems, moves, reward-screen redesign, shop overhaul) is more entangled. Park those behind playtest feedback.

### Per-phase impact if we *did* pivot fully

| New idea | Where it lands | Impact on existing phase |
|---|---|---|
| **Gilded gems** (cascade-void spawn + gold harvest) | G.5 or M1 | Uses the 4+ "special tile" slot in match-size scaling — already reserved as TBD. Plugs into existing cascade-multiplier pipeline. Small. |
| **Pool gems** (registry, spawn injection, match rules) | M2 | Reuses Phase F's `Cell.flags` primitive. New: gem-spawn weighting logic in `core/board/refill`. Moderate. |
| **Moves** (charges, UI tray, activation, effects) | M3 | New: move-engine + tray UI. Could partially reuse spell-cast pipeline. Moderate-to-large. |
| **Reward screen redesign** (3-category picker) | Modifies H1 | Phase H1's "pick 1 of 3 relics" expands to "pick 1 of 3 from gem / move / utility categories." Significant UX redesign. |
| **Relic scarcity** (elite/boss only) | Modifies H1 + I | Changes reward distribution. Elite secondary-pick added. Shop loses relics. Affects gold-flow tuning. |
| **Shop overhaul** (gems / moves / heals / subtractions) | Modifies I | Phase I's shop content changes entirely. |
| **Rest expansion** (sharpen move / retune pool) | Modifies I | New rest-node options gated on owned moves/gems. |
| **Map adjustments** (denser shop/rest, pre-boss shop, visible rest options) | Modifies H1 | Map-gen rule changes. Small. |
| **Initial content** (10 gems + 10 moves + 6 utilities) | Modifies J2 | Phase J2's "content fill + tuning" expands from 15 more relics → fewer relics + 26 new entries. Large. |

### Minimum-viable pivot ordering (if Path B chosen)

If the call ends up being "pivot now," the cheapest sequence would be:

1. **M1: Gilded** — small, additive, validates the on-board economy idea.
2. **M2: Pool gems** — proves the deckbuilding-for-match-3 thesis.
3. **M3: Moves** — adds the second normal-encounter axis.
4. **M4: Reward screen + relic scarcity** — re-wires reward distribution to support all three axes.
5. **M5: Shop + rest + map tweaks** — completes the economy loop.
6. **M6: Content fill** — 10 gems, 10 moves, utilities, plus rebalancing the relic set for elite/boss-only.

M1–M3 are independent enough to ship and playtest each on its own — each one is a "is this idea good?" gate before committing to the next.

### What this doc is *not* asking for

It's not asking to rewrite `04-roadmap.md` yet. The roadmap is the source of truth for what we're building; this is exploration. If/when the pivot is decided, the roadmap gets the update with the call documented.

---

## Pressure-test priorities

1. **Money-gem spawn rules** — get the cadence right before anything else. Bad pacing here poisons every other reward decision.
2. **Gem cap & legibility** — every new gem type added makes color-counting harder. Hard cap at 4 special gems; every gem must be visually unmistakable on the board.
3. **Moves are the most novel axis** — they read as "abilities" not "stats." Worth leaning into hardest; they also give normal encounters a strong, memorable identity.
4. **Reward overlap** — make sure money-buyable shop items don't duplicate what normal encounters reward, or normal encounters lose meaning.
