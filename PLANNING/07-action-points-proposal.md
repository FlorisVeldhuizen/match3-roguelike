# Proposal: Action Points

Status: **Proposal — under discussion.** Not adopted. Affects 01-design.md (turn structure), 02-scope.md (combat economy), 04-roadmap.md (Phase H2 split).

## Why this exists

H2a delivered multi-enemy plumbing + AOE + Skirmisher. While reviewing it, an honest design question surfaced: **does our combat shape actually fit multi-enemy encounters?** Today the player has *one swap of agency per phase*; multi-enemy fights scale pressure linearly with enemy count, so a 3-pack ambush is harder than the player's response surface can absorb. Lane matching, role-mix groups, and per-enemy cooldowns were considered. After a research pass through Pazudora, Puzzle Quest 3, Marvel Puzzle Quest, Three in a Rogue, and Roguematch, **Action Points** (PQ3's design, also echoed in Pazudora's drag-trail and MPQ's multi-character action model) emerged as the cleanest fit for our structure.

This doc proposes adopting AP, locks the mechanics, and walks through implications across the rest of the game.

---

## The mechanic in one paragraph

Each player phase begins with **N Action Points** (locked at **3** for the Knight, no scaling stat in the slice). Each gem swap costs **1 AP**. The phase ends when AP reaches 0. **Spells (Bulwark, Reinforce, Riposte) cost 0 AP** — they remain gated by mana / skill charge and can be cast freely between swaps. Big matches grant bonus AP: **4+ match → +1 AP this phase**, **5-line / T / L match → +2 AP this phase**, capped at a sane ceiling (proposed: 6 AP active at once). End-of-phase resolution still fires once after the last swap.

### The change in one diagram

```
Today (one-swap phase):
  Player:  [ 1 swap → pools resolve → enemy turn → 1 swap → ... ]

Proposed (AP phase):
  Player:  [ 3 AP: swap, swap, [cast Bulwark — free], swap → pools resolve → enemy turn → 3 AP refilled → ... ]
```

The unit of agency goes from `one swap` to `one phase containing 3 swaps + optional free spell casts`. Enemies still act once between player phases. The cadence stays the same; the *content* of each player phase widens.

---

## What this fixes

1. **Multi-enemy agency asymmetry** (the inciting complaint). 3 AP vs. N enemy intents means the player has roughly proportional response budget. A 3-enemy fight isn't lethal-by-default because the player has time to match for block, match for damage, and cast a spell — instead of choosing one.
2. **The "wrong colour board" complaint.** Today, a phase that gives no blue often means eating the enemy attack to the face. With AP, the first swap might fail to find blue, but the player has 2 more attempts.
3. **Spells become real combat tools, not luxuries.** Today, casting a spell *uses* the phase — you swap *or* cast (in practice, you swap because the spell only resolves at phase end). With AP, spells are free between swaps, so casting Reinforce mid-phase to prep for a heavy hit becomes a real option.
4. **4-match's design surface is more honest.** Today, "4-match grants an extra turn" makes extra-turn chains uncapped and creates an EOP-timing edge case (do end-of-phase effects fire between extra turns? today: no). With AP, "4-match grants +1 AP" is bounded by the AP cap and folds into the existing rule set.

---

## What this risks

1. **The TheXboxHub critique:** if enemies don't scale with the player's extra agency, fights flatten — the player overpowers everything because they're doing 3× the work per phase. Compensated by re-tuning enemy HP / damage (below). This is real work, not a free win.
2. **Cognitive load increase.** Today, 1 swap = 1 decision. With AP, the player plans 3 swaps + spell timing per phase. Higher ceiling, higher floor — could feel overwhelming early. Mitigated by Knight starting at 3 AP rather than a higher number, and AP being a visible HUD element.
3. **Cascade interaction.** A 3-cascade chain triggered by one swap is still **one swap = 1 AP**. So a player who plans a cascade-bomb gets massive value per AP. That's *intentional* — cascades are the depth lever. But cascade chains that also hit the 4+ bonus could create runaway turns. Cap (AP ceiling of 6) handles this.
4. **Existing test suite assumes 1-swap phases.** 170 tests, many of which set up phase-end resolution. Roughly half will need updating for the new phase boundary.

---

## Single-enemy encounter implications

This was the user's specific question and deserves its own section.

**Today's solo fight (e.g. col-0 Brute):**
- ~5-8 phases to kill (player builds ~4 red per phase on average, Brute = 20 HP)
- Brute fires ~3-4 attacks for 3-5 damage each → player takes ~15 damage over the fight
- Tight; one bad colour phase costs HP

**With AP=3, same Brute, no rebalance:**
- Player builds ~12 red per phase (3 swaps × ~4 red avg) → Brute dies in ~2 phases
- Brute fires once → player takes 3-5 damage total
- Trivial; fight has no shape

**With AP=3 + rebalanced Brute:**
- Brute HP raised to ~40-50 (≈ 2.5× current), damage to 6-9 (≈ 2× current)
- Same ~3-phase fight duration as today's 5-8 (faster because per-phase output is higher; pacing recalibrated)
- Per-phase decisions denser (which 3 swaps? cast a spell? bank a 4-match into +1 AP?)
- Same *texture* of "tense, you can lose if you mismanage," at a different *tempo*

**The key claim:** AP doesn't trivialize solo fights, it *compresses* them. Same difficulty curve, fewer-but-thicker phases. Each phase is more decision-dense; runs are shorter in phase-count but not in real time. A run that today is ~60 phases at ~30 sec/phase = ~30 min becomes ~30 phases at ~60 sec/phase = ~30 min. Same wall time, deeper turns.

**Solo-fight texture wins:**
- **Spells get used regularly.** Today Bulwark is "save it for a big blue phase"; with AP, casting it mid-phase to convert this phase's blue into damage is a real option.
- **4-match planning matters.** Today 4-match just gives a bonus phase. With AP, banking the +1 AP for a setup-then-payoff swing across two phases is a real plan.
- **Status effects breathe.** Burn ticks once per player phase. With phases now denser, statuses last for more in-fight decisions per stack. Burn 3 hits across ~9 swaps instead of ~3 — bigger window for the player to feel the pressure.

**Solo-fight texture risks:**
- **Cascade-bomb solo fights** could one-shot bosses. A 3-AP phase with a cascade-Crystal + Sharp-Edge + Cascade-Crystal-Crystal setup might delete the boss in one phase. Cap solves this only if the cap is tuned right.
- **First-time-feel** changes. Today's "make one swap, see what happens" is approachable. AP's "spend 3 swaps before anything happens" requires more upfront planning. First-phase tutorial overlay (Phase L) becomes more important.

---

## Multi-enemy encounter implications

What the whole conversation was about. With AP=3 and a 2-enemy fight (e.g. Skirmisher + Smolder in col 2):

- Player has 3 swaps to: deal damage, build block, manage the burning tiles Smolder placed last phase, dodge Skirmisher's incoming attack.
- Spells (free): cast Bulwark to convert blue → damage, *and* cast Reinforce to double residual block — both in one phase, both gated only by mana.
- AOE matches still fan out, but now the player can also focus single-target via a vertical match if one enemy is the priority. Position choice matters because each match is a precious AP spend.

**Lane matching (previously considered) becomes optional, not necessary.** Without AP, lanes were the only way to give the player meaningful per-match targeting. With AP, the player picks which enemy to focus on via multiple swaps. Lanes could *still* be adopted as a depth lever — but the AP economy alone fixes the asymmetry.

**Role-mix composition (also previously considered) stays useful as a balancing tool.** Two Brutes is still a damage-stack problem even with AP; a Brute + Caster is a damage + verb pressure problem that the player can answer across their 3 swaps. Editorial rule on multi-enemy compositions should remain: never two of the same archetype.

---

## Unused AP, end-of-phase, end-turn button

Researched four design patterns: lose, bank-to-next-turn (Divinity OS II), convert to defense (Fallout), convert to interrupt (D&D / classic X-COM). Match-3 fit favours **lose** + manual end-phase button — banking invites degenerate skip-to-burst play that cascades amplify dangerously, defense conversion shifts every match's value calculation, interrupt is too complex for our pacing.

**Locked:**
- **Pattern: lose unused AP.** Matches PQ3. Simplest model, no degenerate banking.
- **Manual "End Phase" button** in the HUD. Available whenever AP > 0 and the board is settled (no cascade in flight). Auto-end fires when AP reaches 0.
- **Confirmation prompt only when ≥ 2 AP unspent.** Skip the prompt at 1 AP — small enough to be intentional.
- **Keyboard binding: Tab.** Spacebar is reserved for the fast-forward (Phase L); Tab is unused.

**"Patient Strike" relic candidate (logged for J2):** *Unused AP at phase end → +1 block each.* Builds a passive-defense playstyle as a relic, not a core rule. Keeps the core economy clean while unlocking the Fallout-style design space for players who want it.

---

## How enemies fit

**Enemies do NOT get AP.** Each enemy fires **one telegraphed intent per enemy turn**, same as today. The asymmetry is intentional: AP is a player-side agency expander, not a global rule. Staying with one-intent-per-turn preserves the StS pacing the game is built around — the player reads the board state of intents and answers them.

Two knobs remain for rebalancing:

1. **Flat number bump** (HP + damage scaled). Each enemy hits *harder* per turn instead of *more often*. A Brute that used to attack for 4 might attack for 7 — the player has 3 swaps to react to one big hit, not 3 small ones. Maps cleanly onto the player's expanded agency.
2. **Verb-density** (H2b/H2c verbs). Column smash, petrify, hex are already more consequential against 3-AP phases. A petrified row blocks 3 swaps of routing instead of 1. The verbs do meaningful rebalancing without number bumps.

**Recommended approach:** lean on **verbs first**, **flat bumps second**. Verbs are the design's existing answer to "enemies need more presence per turn"; AP makes them naturally more impactful. Number bumps fill the gap for stat-only archetypes (Skirmisher, Brute pre-verb-retrofit).

### Per-archetype rebalance (initial cut)

| Archetype | Today | With AP | Reasoning |
|---|---|---|---|
| Skirmisher | HP 11, dmg 2-3 | HP 14, **dmg 4-5** | Pure stat archetype; bump is the only lever |
| Brute | HP 20, dmg 3-5 attack, blocks | HP 35, dmg 6-9 attack, blocks | Bigger HP pool to absorb 3-AP damage output; harder attacks. Column-smash verb (H2b) adds verb-density on top |
| Smolder | HP 18, dmg 2-4 + burn riders | HP 24, dmg 4-6 + burn riders, tile-burn already in pattern | Verb already in pattern, small stat bump |
| Defender (H2b) | TBD | HP 40, block-heavy, petrify-row verb | Verb-density handles the work; flat bump for survivability |
| Caster (H2c) | TBD | HP 14, debuff + hex verb | Fragile attacker; verbs apply pressure across phases |
| Swarmer (H2c) | TBD | HP 8, low dmg, cluster-shove verb | Multi-enemy spawn (groups of 2-3) provides pressure; per-unit is light |
| Boss (Corruptor / J1) | HP 120 | HP 180-200, curse-conversion verb on cadence | Big HP pool for boss-fight stretch; verb is the identity |

The TheXboxHub critique ("single-action enemies feel weak against multi-action players") applies *less* to us than to PQ3 because:
1. Our enemies' single action is **a full action** (a heavy attack, or a verb that flags board cells for multiple phases). Not "one swap's worth of effect."
2. Verbs persist across the player's whole 3-AP phase. A petrify-row landing means **all 3 swaps** that phase are constrained, not just one. That's automatic verb-density.
3. The enemy's **information advantage** is real: telegraphed intents mean the player's wide agency is balanced by needing to plan around known threats. A player with 3 free swaps but a Brute telegraphing "attack for 8" is constrained to spend at least one of those swaps on defense.

---

## Concept-by-concept rebalance

AP touches more than just "swaps per phase." Every system that has "per-phase" or "per-turn" semantics needs a sanity check. Below is the conservative read (the AP-aware change to each existing system) and, where it makes sense, a **creative stretch** (a more ambitious redesign that the research surfaced).

### Match-tier rewards — the big one

The Bejeweled tier system gives us a clean model: **match-3 is the base; match-4, T/L, and match-5 each create a distinct *power gem* that sits on the board**. We already do this once (the `blessed` flag from 5-line). The creative reframe is to do it for *every* tier.

**Two axes, kept separate.** Match *size* (3, 4, 5 in a line) drives the AP economy. Match *shape* (T, L, +) keeps its current AOE-only role. Mixing them was a mistake — T/L getting AP bonuses double-dips with their existing identity as the "wide damage" tier, and the player ends up with three knobs (size, shape, AOE) that all converge into the same reward currency. Better: size is the AP lever, shape is the AOE lever.

**Conservative path (PQ3-style, immediate AP):**
| Match | Current effect | With AP |
|---|---|---|
| 3 in a line | Pool gain | Unchanged |
| 4 in a line | +1 turn (uncapped chain), pool gain | **+1 AP this phase (capped at AP ceiling)**, pool gain |
| 5+ in a line | AOE clear of row/col, blessed cells, pool gain | AOE clear, blessed cells, **+2 AP this phase**, pool gain |
| T / L / + (any size) | AOE damage to all enemies, pool gain | **Unchanged — AOE damage only, no AP.** Shape rewards stay as the AOE knob. |

Pros: minimal design churn, immediate feedback, AP cap (6) prevents runaway chains, T/L keeps its distinct identity.
Cons: same auto-resolving model we have today; no cross-phase strategy from match tiers.

**Creative path (Bejeweled-style, persistent power gems):**

Each special match drops a **persistent gem** on the board. The gem inherits flag semantics (we have the infrastructure from `burning` + `blessed`). Activating it = matching it.

| Match | Power gem created | Activated by | Effect on activation |
|---|---|---|---|
| 4 in a line | **Spark Gem** (yellow halo, glowing) | Matched as part of any later match | +1 AP **on activation** (cap permitting) |
| 5 in a line | **Hypercube** (color-shifting) | Swapped *into* | Destroys all gems of the swapped-with color, massive pool, +2 AP |
| T / L / + | (no power gem) | — | Stays as immediate AOE damage |

Pros: cross-phase strategy ("save the Spark for the boss fight"), legible visual layer, opens up relic design surface ("relic that turns 3-matches into Spark Gems," etc.).
Cons: significant board-rendering work (new sprites + match-rule interactions), persistent-gem semantics need careful design (what if a Spark Gem is hit by a column-smash verb?), bigger scope.

**Recommendation:** ship the **conservative path** in the H2-AP slot. Log the **creative path** as Phase L "depth pass" territory — once the AP economy is proven, the persistent-gem layer becomes a polish-time feature that elevates the game without urgent need.

### Cascades

**No change.** Cascade multipliers (1.5× / 2× / 2.5×+) stay pure pool multipliers. They don't grant AP — cascades are the *depth lever* on top of AP. A 3-cascade chain triggered by one swap is "1 AP, huge payoff" — that's the cascade's existing identity and AP doesn't dilute it. If anything, AP makes setup-then-payoff cascade play more accessible because you have multiple swaps per phase to set up.

### Blessed cells

**No change.** 2× pool multiplier on match. Blessed is a pool doubler, not an action multiplier. Keeping it pool-only avoids stacking with AP bonuses in confusing ways.

### Burning cells (Smolder verb)

**More dangerous in AP land.** With phases now spanning 3 swaps, the player has more chances to *accidentally* match a burning cell. Smolder's tile-burn becomes proportionally scarier. Mitigation: re-tune Burn-from-tile bonus (`BURN_FROM_TILE_BONUS` constant in `content/statuses.ts`) down from 1 to 0, or reduce `tileBurnDuration` from 3 to 2. Decide during playtest.

### Status effects (Burn, Vulnerable, Weak)

**Tick frequency unchanged: once per owner's phase.** Phase = 1 stacks-unit, as today. *But* phases are now 3× denser, so:
- Burn 3 affects ~9 swaps of player decisions across its 3 phases. Status weight effectively up.
- Same goes for Vulnerable / Weak — their multiplier-active windows now span more swaps each.
- **Tuning consequence:** starting stacks may need to drop. Burn 3 today → maybe Burn 2 with AP. Vulnerable 2 → Vulnerable 1 with longer effect per stack.

### Resolute passive (+2 block / phase, +1 per consecutive blue-less phase, cap +5)

**Threshold needs review.** With 3 swaps per phase, the player is much more likely to match blue at least once per phase. "Consecutive phases without blue" becomes rare, so Resolute's scaling rarely triggers. Two options:
- Lower the scaling cap (5 → 3) since it rarely caps anyway. Quiet nerf.
- Redefine the trigger: "phases without blue *pool resolution >= N*" instead of "without any blue match." More granular.

I lean toward the first — simpler, accepts the reality that Resolute's scaling tail is less load-bearing now.

### Spells (Bulwark, Reinforce)

**Costs probably go up.** With AP, the player has more swaps per phase → more yellow matches → more mana → spells available more often. Mana costs need to rise to keep spells aspirational rather than routine.

| Spell | Today | With AP (proposed) |
|---|---|---|
| Bulwark | 3 mana, blue → attack at floor(blue/2) | **4 mana**, same effect |
| Reinforce | 4 mana, double block on carry | **5 mana**, same effect |
| Riposte (ult) | 8 charge, parry next attack | **10 charge**, same effect |

These are first-pass numbers; expect a J2-style balance pass to dial them in. The principle: spells should fire ~1× per fight, not ~1× per phase.

### Ultimate (Riposte)

Unchanged mechanically. Charge cost bumped (see above) since purple matches accumulate faster too.

### Pool resolution

**No change to the timing model.** Red / green still commit per-match during cascade; blue still resolves at EOP. EOP now means "end of the player phase (when AP hits 0 or player ends manually)" instead of "after the swap." Cleaner: one EOP per phase, regardless of swap count. Existing event order preserved.

### Relic hooks

All existing hooks fire correctly under AP. The only redefinitions:
- `onPhaseStart` / `onPhaseEnd`: phase boundary now defined by AP exhaustion + manual end, not per-swap. Semantically the same — these were always "once per player phase" hooks.
- `onMatch`: unchanged, fires per match in the cascade.
- `onCascade`: unchanged.
- `onSpellCast`: unchanged. Fires when player casts (mid-phase now possible cleanly).

**Phase E's Cascade Crystal works as-is.** Sharp Edge, Iron Buckler, etc. — all unchanged. The AP layer is *additive*; it doesn't reshape the hook surface.

### Map / run pacing

**Wall-time roughly unchanged.** A current fight is ~5-8 phases × ~30s = 2-4 min. AP fights are ~3-4 phases × ~60s = 3-4 min. Per-fight decisions denser; run length similar.

Scope doc target: 10-15 min runs. We're closer to 20-30 today with full H1; AP doesn't change that trajectory either way.

---

## Public reception summary

| Position | Camp | Source |
|---|---|---|
| Pro-AP: "lets me plan, removes time pressure" | Players who came for the puzzle, not the reflex | PQ3 community thread |
| Pro-AP: "biggest improvement since launch" | Developers | PQ3 dev blog |
| Anti-AP: "removes strategic element; enemies feel weak by comparison" | Players who valued one-action symmetry | TheXboxHub review |
| Anti-AP: "can't keep up with timer-mode optimisers in high tiers" | Competitive players | PQ3 community thread |

What we learn: **the mechanic is divisive when it competes against a tighter alternative (timer mode in PQ3).** In our game there's no timer-mode alternative — the only alternative is the current one-swap-per-phase model, which by our own admission has the multi-enemy agency problem. We're not asking players to choose between two modes; we're upgrading the only mode. That defuses one major axis of the critique.

The remaining critique (enemies feel weak) we directly address by re-tuning enemy stats and keeping intents fully-telegraphed.

---

## Locks & open questions

### Locked

| Decision | Value |
|---|---|
| Base AP | 3 (Knight, slice-locked) |
| AP cap | 6 |
| AP bonus timing | **Immediate** (4-match → +1 AP this phase, not next) |
| Match-tier rewards | Conservative path: 4-in-line → +1 AP, 5+-in-line → +2 AP. T/L stays AOE-only (no AP). All bonuses immediate. |
| Carryover | Lost at phase end |
| End-phase button | Yes (Tab key), confirm prompt only if ≥ 2 AP unspent |
| Spell AP cost | 0 (free, gated by mana/charge as today) |
| Bulwark resolution timing | Cast is free mid-phase; effect still fires at EOP |
| Enemies get AP? | No — one intent per turn (StS-style), rebalanced via HP/damage bumps + verb-density |
| `extra-turn` event | Removed; replaced by +1 AP bonus on 4+ matches |

### Still open

1. **Persistent power gems (Bejeweled-style)** — adopt the creative path for match-tier rewards (Spark Gem, Star Gem, Hypercube), or stay on the conservative path? Conservative is the recommendation for the slice; persistent gems logged as a Phase L depth pass.
2. **Status starting-stack tuning.** Burn 3 today may want to become Burn 2 with AP. Vulnerable/Weak similar. Resolve during content rebalance, not now.
3. **Spell costs** (proposed: Bulwark 4, Reinforce 5, Riposte 10). First-pass numbers — playtest will dial in.
4. **Resolute cap** (current +5; proposed +3). Same — tune in playtest.
5. **Tile-burn cell tuning** (`BURN_FROM_TILE_BONUS`, `tileBurnDuration`). Adjust if Smolder's verb proves disproportionately scary under AP. Playtest, not now.
6. **AP for the boss / future classes.** Knight = 3 in slice. Boss could have AP-aware mechanics (e.g. Corruptor curses one of your AP each conversion turn?). Out of scope until J1.

---

## Implementation surface (rough)

If adopted, the changes split into three commits:

### Phase H2-AP-1: Engine
- `Player.actionPoints: number` (current) + `Player.maxActionPoints: number` (base + earned bonuses, capped)
- `Player.apEarnedThisPhase: number` (resets each phase)
- `attemptSwap`: decrement AP by 1 on valid swap; check AP > 0 in gate
- `beginPlayerPhase`: reset AP to base + carryover (decided: no carryover, so just base)
- Match-walker: detect 4+ and 5/T/L matches, grant AP bonuses (subject to cap)
- Phase-end trigger: AP reaches 0 → EOP resolution + enemy turn
- Remove `extra-turn` mechanic; replace with AP bonus on 4+ matches
- **Test impact: ~50 tests touch turn structure. Re-tune expectations.**

### Phase H2-AP-2: Content rebalance
- Per-archetype HP/damage bumps per the rebalance table (Brute 20→35 HP, Smolder 18→24, Skirmisher 11→14 with damage 2-3 → 4-5, Boss 120→180). Verbs do the rest.
- Enemies still fire **one intent per turn** — no `executeEnemyTurn` change.
- Status effects: Burn starting stacks 3→2; Vulnerable/Weak starting stacks 2→1 (longer multiplier window per stack already from denser phases).
- Spell mana costs **up** (more swaps = more mana = spells need to feel aspirational): Bulwark 3→4, Reinforce 4→5, Riposte 8→10.
- Resolute cap 5→3. `phasesSinceBlueMatched` threshold review.
- Tile-burn: re-tune `BURN_FROM_TILE_BONUS` (currently 1) and `tileBurnDuration` (currently 3) only if playtest shows Smolder is disproportionate.

### Phase H2-AP-3: HUD + UX
- AP counter in HUD (visible, prominent — replaces "extra turn" indicator)
- Phase indicator updated to show "Phase N · X AP"
- "Pass" button for early phase end
- Tutorial/first-encounter tooltip for AP (Phase L territory)

**Total estimate: 8-12 hours.** Bigger than a normal phase, smaller than H2 was supposed to be. Reasonable to slot between H2a and H2b on the roadmap if adopted.

---

## Critical review & open tensions

Reading this doc back end-to-end, several things stand out as either fragile, under-thought, or worth pushing back on. Listing them honestly before any commit.

### Things that feel solid

- **AP as a player-side budget, no enemy AP.** Direct fix to the multi-enemy asymmetry. Cheap to implement (a counter + a phase-end condition). Preserves StS pacing.
- **Match-size as the AP lever; match-shape stays as the AOE lever.** Two axes of reward, two distinct knobs. T/L doesn't compete with line-4 for the same reward currency.
- **Manual end-phase button + lose-unused-AP.** No degenerate banking, no missing UI affordance.
- **Spells stay free relative to AP, gated by mana.** Lets the player chain a swap → cast Bulwark → swap, which makes spells *combat tools* instead of *end-of-phase finishers*.

### Things that worry me

1. **The 4-match reward shrinks dramatically.** Today: 4-match = entire extra phase = ~3 free swaps under AP. Tomorrow: 4-match = +1 AP = exactly 1 extra swap. Mathematically that's a 3× nerf to one of the game's most satisfying beats. The player who today builds a cascade-bomb-via-4-match-chain may find AP's bounded reward less exciting.
   - **Mitigation A:** *Persistent Spark Gem* (the creative path) — 4-match still feels rewarding because the gem sits on the board and the player keeps the option to convert it later. The reward becomes a *choice*, not just a number.
   - **Mitigation B:** higher 4-match bonus (+2 AP instead of +1) — but this pushes against the AP cap and invites chain explosions.
   - **My honest read:** the conservative path (just +1 AP) may feel anticlimactic. The Spark Gem might actually be worth slotting into H2-AP-1, not Phase L. Re-evaluate after playtest.

2. **The "no AP from cascades" rule is load-bearing but unsexy.** A cascade is "1 AP, big payoff" — design-intent is that cascades are the depth-via-positioning lever. But the player who lands a 5-cascade chain with several 4-matches in it could be confused: "I made four 4-matches in this cascade — do I get +4 AP?" If yes → runaway turns. If no → "why did my big chain not pay out in AP?"
   - **Locked answer (now):** 4-matches in cascades grant AP at most up to the cap. So a 4-match in cascade level 3 still grants +1 AP, but the AP cap (6) bounds the total.
   - **Open question:** is the cap *per phase* or *as a hard ceiling*? I leaned "max AP at any moment = 6" — but a player who's at 6 AP and lands another 4-match gets *nothing*. That's a feels-bad moment. Alternative: cap how much AP is *granted per phase* at 3, regardless of current AP. Worth thinking through.

3. **The +50% block from Resolute becomes harder to trigger.** With 3 swaps per phase, the player almost always matches blue at least once, so "phases without blue matched" — the Resolute scaling — almost never accumulates. This is a quiet nerf to the Knight's identity passive. Proposed fix: lower the cap (5→3). Real fix: re-think Resolute. *Is* its current shape still the right one? Maybe it should scale on something else — e.g., consecutive *low-pool* phases — or be replaced with a different passive entirely.

4. **The "extra-turn" event removal touches a lot of code.** The event is consumed by FX, SFX, the HUD banner, status-tick decisions, relic hooks. We can probably collapse it cleanly to "+1 AP granted" (which has its own FX moment), but the search-and-destroy is non-trivial. Test impact ~50 tests is realistic; could be more.

5. **The 4-match-chain "feel" is lost.** Today, landing a 4-match feels great because you keep swapping — kinetic feedback. With AP, you... see a "+1" pop on the AP counter. Still good, but less *kinetic*. Could be a Phase L FX problem, not a design problem — a satisfying "+1 AP" burst could carry it. But worth flagging.

6. **Single-enemy fights might become *too* dense.** The proposal says compressed fights are fine. But against the easiest col-0 Brute, 3 swaps + free spells + immediate damage commit could one-shot the enemy in one player phase, and the player never gets the satisfying back-and-forth of "I hit, it hits, I hit." Solo-fight tuning is the most fragile balance work the AP shift creates.

### Creative tensions worth thinking through

- **Persistent Spark Gem from match-4 vs. immediate +1 AP.** I parked persistent gems in Phase L. But the more I look at the conservative path, the more the immediate +1 AP feels flat compared to today's "extra turn." If we're going to disrupt the player's existing muscle memory anyway, *give them something better*, not equivalently-numerical. The persistent gem is *more* interesting, not less. Worth reconsidering as part of the slice.
- **5-line match's current rewards already double-up.** It clears a row/column, drops blessed cells, *and* (under this proposal) +2 AP. That's three things from one match. Is that too much, or appropriate for the rarest match type? Probably appropriate, but worth a gut check.
- **The "Patient Strike" relic idea.** Unused AP → +1 block each at phase end. Currently scoped as J2. But it might be one of the *most interesting* relics for shaping playstyle — "save your AP for defense" vs. "spend it all for aggression" is a real strategic axis. Possibly worth promoting into the Phase G common-rarity slot.
- **Mid-phase block decisions.** With AP, the player can cast Bulwark mid-phase. But Bulwark's effect resolves at EOP — so the cast is a *commitment*, not an immediate effect. That's fine, but maybe Bulwark *should* resolve on cast under AP? "Convert my current blue pool right now to attack" is a more visceral spell. Could be a Phase F design revisit.

### A combination I keep coming back to

**AP + persistent Spark Gem + "Patient Strike" relic from Phase G.** Together:
- AP gives the player wider per-phase agency (the asymmetry fix)
- Spark Gem gives the 4-match reward a sense of *banked future power*, not a numerical nerf (the kinetic-feel preservation)
- Patient Strike lets a defensive build *bank AP into block*, completing the design space (passes vs. spends become a real strategic choice)

This combination is more cohesive than any of the three alone. Worth considering as the *real* slice plan, even though it's bigger than the conservative path.

---

## Conclusion

**Adopt AP.** The asymmetry fix it provides for multi-enemy fights is the single cleanest answer the research surfaced, and it works in the structure we have. The risk is real (TheXboxHub-style enemy weakness, single-enemy density, 4-match kinetic-feel) — but every alternative I considered (lanes, stagger, role-mix, drop multi-enemy) had bigger structural costs or smaller solved-problem footprints.

**Two paths to choose between, doc-locks-the-conservative-one:**
- **Conservative slice plan:** AP + match-size bonuses (no T/L AP, no persistent gems), enemy stat/verb rebalance, ~8-12h implementation.
- **Ambitious slice plan:** the same, **plus** persistent Spark Gem from match-4 (cross-phase agency), **plus** promote Patient Strike to a Phase G relic. ~14-18h implementation. Cohesive package; more design surface to playtest.

**My recommendation has shifted while writing this section.** The conservative path is *defensible* but the 4-match reward shrink is a real concern. The ambitious path is *better-designed* — the parts reinforce each other. If we can afford the extra ~6h, the ambitious path produces a more interesting game.

### Open questions that block deciding

1. **Conservative or ambitious slice plan?** This is the call to make.
2. **If conservative:** is the +1 AP from match-4 *immediately* satisfying enough in playtest, or do we eventually need to add persistent gems anyway?
3. **If ambitious:** Spark Gem visual + match-rule interaction design — needs a small spec pass before implementation.
4. **Tuning order:** ship engine + numbers + HUD as separate commits, or one big drop? I lean separate (engine commit can be tested in isolation; content commit is its own playtest-driven iteration).

### Open questions that *don't* block deciding (defer to implementation / playtest)

- Status starting stacks (Burn 3→2, etc.)
- Spell cost numbers
- Resolute cap
- Tile-burn tuning
- AP cap "max-at-moment" vs. "max-granted-per-phase"

These are dials, not decisions. They'll move under playtest no matter what we pick.

---

## Recommendation

**Adopt AP, with the locks above (immediate bonus, no carryover, cap 6, pass button), defer balance tuning to J2's content pass.** The mechanic directly answers the multi-enemy question without forcing a concept rework (lanes) or a content constraint (role-mix only). It also incidentally fixes the "wrong colour" frustration and unlocks spell-economy depth.

The honest risk to flag: this is a *bigger* change than the slice currently calls for. Phase H2a's work isn't wasted — multi-enemy plumbing, AOE, Skirmisher all still apply. But H2b and H2c's verb designs will need a lane-aware-vs-AP-aware pass, and the J2 balance work just got more important.

If adopted: amend `01-design.md` §3 (Turn structure) and `02-scope.md` §Difficulty curve. Move the existing H2b/H2c entries in the roadmap to *follow* an H2-AP slot.

If not adopted: log this proposal as considered-and-rejected with a note on why, so future-us can find it.
