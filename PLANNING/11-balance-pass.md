# Balance pass — spells, mana, relics, synergies

**Status:** planning only (2026-05-27). No implementation until explicitly scheduled.  
**Source:** design discussion (mana economy, spell power, relic pick rates, synergy clusters).  
**Code truth for numbers today:** `src/types/index.ts` (`MANA_CAPS`), `src/content/spells.tsx`, `src/content/relics.ts`.

---

## Goals

1. **Spells should cost real planning** — especially high-impact immediates like Ignite (felt “free” vs payoff).
2. **Preserve memorable synergies** — cascade engines, Bulwark+Reinforce, setup→payoff; tune ceilings, don’t flatten identity.
3. **Fix correctness before tuning** — relics/spells that don’t fire skew balance perception.
4. **Make synergies legible** — reward screen / tooltips later; this doc defines *what* should combo.

---

## Current economy (shipped)

### Dual track per match

| Track | Behavior |
|-------|----------|
| **Combat** | Red/green commit per match; blue → block at end of player phase |
| **Mana** | Same match also fills `player.mana` (persistent across fights in a run) |

Spending mana does **not** reduce match payouts — spells compete with hoarding, not with “match or cast.”

### Caps (`MANA_CAPS`)

| Pool | Cap | Rationale (shipped) |
|------|-----|---------------------|
| Red / Blue / Green | **8** | ~2–3 matches of one color to afford a typical spell |
| Yellow (wild) | **5** | Flex; lower so yellow doesn’t dominate |

### Spell costs (shipped)

| ID | Cost | Resolution |
|----|------|------------|
| bulwark | 3B | EOP |
| reinforce | 4B | EOP |
| ignite | **3R** | immediate |
| volley | 4R | EOP |
| skewer | 2R | next red match |
| brittle | 3B | immediate |
| chain-lightning | 3R | next red match |
| cinder-lash | 2R + 1G | immediate |
| focus | 2Y | immediate |
| surge | 3Y | next match (+2 cascade level) |
| shatter | 4Y | immediate |
| transmute | 3Y | immediate |
| regenerate | 3G | immediate |
| purify | 2G | immediate |
| blessed-ground | 3G | immediate |
| frozen-wall | 3B | immediate |
| riposte (ultimate) | 8 purple charge | pending |

### Why Ignite feels strong (playtest signal)

- **3 red** ≈ one clean 3-match of red (or wild substitution) **in addition to** that match’s immediate red damage.
- **3 Burn** → **6 HP** over three enemy turn-starts (3+2+1), often on top of normal red pressure.
- No opportunity cost on the combat track; mana is “extra” on top of matching.
- **No burn relic** yet — Ignite *is* the burn route, so it’s always correct in red-leaning fights.

Raising caps **without** raising costs would worsen hoarding and make Ignite *more* spammable after a lucky fight. **Caps and costs should move together** as the first lever.

---

## Puzzle Quest comparison (reference, not copy-paste)

PQ *Challenge of the Warlords* / PQ2 (see also `06-pq-ideas.md`):

| PQ | Renza (shipped) |
|----|-----------------|
| **~1 mana per gem** matched (3-match → 3 mana) | Match payout ≈ **size × cascade** to pools **and** same deltas to mana |
| **Max mana scales** with class stats (Elemental Mastery → **+Max** per color; late builds often **~15–20+** per color) | **Fixed caps** (8 / 8 / 8 / 5) for whole run |
| **Skulls** = primary HP damage; colored mana mostly fuels **spells** | **Red matches** = immediate damage **and** red mana — spells are “bonus” on top |
| Typical spell **≥5–6** in one color, or **split** (e.g. 4R+8Y, 5B+6G, 3G+3Y+3B) | Most spells **single-color 2–4**; only Cinder Lash is hybrid |
| Casting a spell **is** your turn action (PQ1) / competes with items (PQ2) | Spell = **free action between swaps** in player phase |

**What PQ’s numbers are really doing**

- A **6-cost** spell on a **~20 cap** is ~30% of a full bar — usually **two** focused 3-matches (or one strong line + drip), not one accidental match.
- **Multi-color costs** force **routing**: you can’t spam Ignite off red alone if it costs 4R+2Y — you need board state that supports both colors over a phase or two.
- High caps + carry make **“charging the nuke”** a fight-long mini-game; PQ’s late-game Fire Walker–style builds explicitly hoard red to 20 then cash in.

**What we should borrow**

1. **Higher caps + higher costs** in the same direction (your Ignite observation + PQ anchor).
2. **Floor of ~6** for “real” spells (damage, board edit, major buff) — utilities (Focus, Purify) can sit at 3–4.
3. **More mixed costs** on discoverable spells — engine already supports `ManaCost` + wild substitution (`08-multi-color-mana-proposal.md`); content barely uses it.

**What we should not copy blindly**

| PQ pattern | Renza reason to differ |
|------------|------------------------|
| Flat 20 cap from minute one | Slice has no mastery stat ladder; **flat 20 day-1** = empty spell tray early unless starters are discounted |
| Skull-only damage | Per-match red commit is core; don’t gut match damage to justify spell costs |
| Spell = whole turn | Free-between-swaps spells will **always** feel spammier than PQ at equal numeric cost — may need **6–8** where PQ needs **6** |
| No mana cap (some modes) | We want hoarding as strategy; cap + overflow waste creates tension |

**Recommendation:** Treat PQ as a **ratio target**, not a literal port. Prefer **Phase 1b (PQ-aligned)** below over the smaller Phase 1 step if we want the genre to “feel like PQ” in pacing; use Phase 1 only as a low-risk playtest increment.

---

## Phase 1 proposal — modest increment (+50% caps, ×1.5 costs)

**Intent:** Small step to validate direction before committing to PQ-scale numbers.

### Proposed caps

| Pool | Today | Proposed | Δ |
|------|-------|----------|---|
| Red / Blue / Green | 8 | **12** | +50% |
| Yellow (wild) | 5 | **7** | +40% (slightly less than RGB so wild stays special) |

Update: `MANA_CAPS` in `src/types/index.ts`, tests in `turn.test.ts`, `mana.test.ts`, `h2b.test.ts`, any HUD “full bar” affordances.

### Proposed spell costs (×1.5, round up)

Rule: `newCost = ceil(oldCost × 1.5)` per color component. Hybrid costs round each component.

| ID | Today | Proposed | Notes |
|----|-------|----------|-------|
| bulwark | 3B | **5B** | Starter — consider **4B** if Knight opener feels too slow |
| reinforce | 4B | **6B** | Pairs with Bulwark; watch Bulwark+Reinforce full-pool combo |
| ignite | 3R | **5R** | **Primary motivator** for this pass |
| volley | 4R | **6R** | Already high-friction UI |
| skewer | 2R | **3R** | Still cheapest red payoff |
| brittle | 3B | **5B** | Enabler — may need power buff if unpicked |
| chain-lightning | 3R | **5R** | Multi-enemy only |
| cinder-lash | 2R+1G | **3R+2G** | Or **3R+1G** if too harsh |
| focus | 2Y | **3Y** | Utility tax |
| surge | 3Y | **5Y** | Cascade build payoff — keep expensive |
| shatter | 4Y | **6Y** | Fight-winner; OK to stay top of bar |
| transmute | 3Y | **5Y** | |
| regenerate | 3G | **5G** | |
| purify | 2G | **3G** | Clutch tool; small bump |
| blessed-ground | 3G | **5G** | Setup spell |
| frozen-wall | 3B | **5B** | Niche defensive |

**Ultimate:** Riposte charge **8** unchanged (purple is separate economy).

### Expected feel after Phase 1

| Metric | Before | After (illustrative) |
|--------|--------|----------------------|
| Matches to cast Ignite | ~1× 3-red match | ~2× 3-red matches (or 1× 4 + scraps) |
| Max hoard per color | 8 | 12 (more “I’m saving for Shatter”) |
| Wild cap | 5 | 7 (Focus 3Y leaves room; Shatter 6Y needs nearly full yellow) |

**Not in Phase 1:** changing Ignite burn stacks, cascade math, or relic numbers — only if playtest still says Ignite dominates after cost bump.

### Phase 1 acceptance checks

- [ ] Ignite no longer spammable every phase in early fights without intentional red focus.
- [ ] Starters (Bulwark / Reinforce / Ignite) still usable within first 1–2 fights without empty spell tray frustration.
- [ ] Yellow spells (Focus / Surge / Shatter) still differentiate by cost tier.
- [ ] Tests updated for new caps and affordability cases.

---

## Phase 1b proposal — PQ-aligned (caps ~20, costs ≥6, more hybrids)

**Intent:** Match the **mana bar length** and **commitment per cast** players know from PQ, while keeping Renza’s dual-track combat + free-cast timing.

### Proposed caps

| Pool | Today | Phase 1b | Notes |
|------|-------|----------|-------|
| Red / Blue / Green | 8 | **18** | ~2.25×; near PQ late-game **feel** without stat progression |
| Yellow (wild) | 5 | **10** | Still < RGB so yellow isn’t strictly better than hoarding primaries |

Optional later: relics / rest nodes **+2 max mana (one color)** to simulate PQ mastery growth without a full skill tree.

### Cost rules (content pass)

1. **Floor:** combat/board spells **≥6** total pips (counting wild substitution value as 1:1).
2. **Starter exception:** Knight starters at **5** (not 6) so fight 1–2 aren’t dead — or grant **+3 starting mana** in first fight only (TBD in playtest).
3. **Hybrid:** shift ~half of discoverable pool to **2-color** costs (thematic pairs below).
4. **Tier ladder:**

| Tier | Total cost | Examples |
|------|------------|----------|
| Utility | 3–4 | Focus, Purify |
| Standard | **6** | Ignite, Skewer, Brittle, Regenerate, Frozen Wall |
| Premium | **8–10** | Volley, Surge, Blessed Ground, Chain Lightning |
| Nuke | **10–12** | Shatter, Transmute |

### Example PQ-style cost table (draft)

| ID | Today | Phase 1b (draft) | PQ-like rationale |
|----|-------|------------------|-------------------|
| bulwark | 3B | **5B** | Starter discount |
| reinforce | 4B | **6B** | |
| ignite | 3R | **4R + 2Y** or **6R** | Can’t one-match cast; routing or full red focus |
| volley | 4R | **6R + 2B** | Spread + defensive color |
| skewer | 2R | **6R** | One big commit for double match |
| brittle | 3B | **4B + 2R** | Setup debuff = offense + defense colors |
| chain-lightning | 3R | **6R** | |
| cinder-lash | 2R+1G | **4R + 2G** | Already hybrid — bump to PQ weight |
| focus | 2Y | **4Y** | Still below floor; color-fix utility |
| surge | 3Y | **6Y** or **4Y + 2R** | Cascade payoff |
| shatter | 4Y | **8Y** or **6Y + 2R** | Nuke tier |
| transmute | 3Y | **6Y + 2G** | Board edit + sustain color |
| regenerate | 3G | **6G** | |
| purify | 2G | **4G** | Clutch, stays cheap |
| blessed-ground | 3G | **6G + 2Y** | Setup |
| frozen-wall | 3B | **6B** | |

**Ignite at 4R+2Y (total 6):** needs red **and** yellow board presence (or wild tax) — directly addresses “one red match + Ignite every phase.”

### Ratio check (Ignite)

| Model | Cap | Ignite cost | % of full bar (one color) | Typical setup |
|-------|-----|-------------|---------------------------|---------------|
| Shipped | 8 | 3R | 37% | ~1× 3-match |
| Phase 1 | 12 | 5R | 42% | ~2× 3-match |
| Phase 1b | 18 | 6R | 33% | ~2× 3-match |
| Phase 1b hybrid | 18R + 10Y | 4R+2Y | 22% + 20% | red focus + yellow drip or wild |

### Phase 1 vs 1b decision

| | Phase 1 | Phase 1b |
|---|---------|----------|
| Risk | Low; easy revert | HUD/readability; early-fight mana famine if starters too high |
| Ignite fix | Moderate | Strong |
| PQ feel | Partial | Close on economy; still faster casts than PQ |
| Multi-color | No content change | Requires spell cost + tooltip pass |

**Suggested path:** playtest **Phase 1** in a branch if unsure; if Ignite still dominates, jump to **1b** (caps 18/10 + 6-floor + hybrid Ignite) rather than inching 12→15→18.

---

## Phase 2+ (after cap/cost land)

| Item | Type | Notes |
|------|------|-------|
| **Afterburner** | Bug | `resolveEndOfPhase` zeros `phasePools` before `onPhaseEnd`; Afterburner reads `phasePools.red` → likely **never fires**. Fix order, then evaluate power. |
| **Iron Buckler** | Copy | Description says “block at EOP”; hook adds **blue pool** per blue match. |
| **Volley** | Design | Defers **all** in-phase red damage; weak at low totals due to 3-way split + flooring. Needs payoff. |
| **Brittle / Regenerate / Thornmail** | Tune | Undertuned or orphan picks — see tiers below. |
| **Burn relic** | Content | Ignite strong partly because no burn build relic exists (Overcharge = Riposte only). |
| **Blessed relic** | Content | Match-5 + Blessed Ground have no relic hook (`onBlessedMatch` teased in design). |
| **Reward synergy hints** | UX | Subtle icon on offers (“↗ Cascade Crystal”) per `05-reward-ideas.md`. |

### Volley rework candidates (design notes)

**Problem:** While `volley` is pending, red-match damage is skipped during cascades. The payoff is end-of-phase split damage:

- With common early totals (3–4 red in a phase), `floor(total/3)` yields **1/1/1** or **1/1/2**. Even when stacking all three hits onto one enemy, that’s often too small to justify the tempo loss.

**Candidate A (simple): double total, then split**

- At EOP, treat `totalRed = phasePools.red` as `totalRed × 2` before splitting into three hits.
- Rationale: Volley “banks” damage all phase; it should pay a premium vs normal per-match damage.
- Watchouts: high-end scaling with Strength/Vulnerable; may need a higher mana cost tier than other red spells.

**Candidate B (floor fix): distribute remainder fairly + per-arrow floor**

- Keep `totalRed` but distribute remainder so low totals feel less wasteful, and add `+1` per arrow (or `minArrow = 2`).
- Rationale: fixes the “useless 1s” without exploding the ceiling.

**Candidate C (hybrid): in-phase red damage still applies; volley adds bonus hits**

- Red matches deal damage as normal; Volley only adds 3 end-of-phase bonus hits from a separate “bank” (or only banks overflow).
- Rationale: removes the negative-tempo feel entirely; more like PQ “setup → payoff” spells.

**Default recommendation:** start with **A** (×2 total) because it’s the smallest behavior change that directly addresses the reported feel problem. Re-evaluate once caps/costs are adjusted (Phase 1/1b).

### Optional Ignite-specific lever (if 5R isn’t enough)

- Reduce `IGNITE_BURN_STACKS` 3 → 2 (total 3 dmg), **or**
- Increase cost to **6R** without further cap change.

Prefer **cost first** to keep status math simple.

---

## Spell tiers (research snapshot)

### S — strong / always consider

Ignite (pre-nerf), Skewer, Focus, Purify, Shatter

### B — context / build

Surge, Chain Lightning, Cinder Lash, Transmute, Blessed Ground, Bulwark, Reinforce

### C — situational / undertuned

Brittle, Regenerate, Frozen Wall, Volley (1v1)

### Parse / trust fixes (copy or behavior)

| Spell | Issue |
|-------|--------|
| Bulwark | Says “armor”; uses **blue pool**, not block stat |
| Volley | Hides that red matches deal **no** damage while loaded |
| Shatter | Long text; omit single-target red (not AOE) |
| Surge | “Two cascades deep” → **cascade level +2** |

---

## Relic tiers (research snapshot)

### S

Sharp Edge, Cascade Crystal, War Drum, Stoneheart

### B — archetype

Iron Buckler, Fortified, Avalanche, Harvester (multi), Spite, Afterburner (if fixed)

### C — rarely exciting

Thornmail, Battle Cry, Morning Star, Collector’s Eye, Overcharge

---

## Synergy clusters (balance + design)

Use this when evaluating changes — **don’t nerf payoff cards in isolation** if they require setup.

### Tier A — run-defining (keep, tune ceiling)

| Cluster | Pieces |
|---------|--------|
| Cascade engine | Surge → Cascade Crystal → Avalanche (+ Sharp Edge) |
| Damage stack | War Drum + Sharp Edge + Brittle + Skewer |
| Blue bomb | Iron Buckler + Bulwark + Reinforce (full pool attack) |
| Board nuke | Blessed Ground → blessed matches → Shatter / Transmute |
| Multi finisher | Chain Lightning + Skewer (multi-enemy) |

### Tier B — coherent, slower

Block fortress (Fortified, Morning Star, Reinforce, Resolute), burn chip (Ignite / Cinder Lash, no burn relic), Volley spread

### Tier C — latent / broken

Afterburner + red bank (broken hook), Battle Cry + spell spam, blessed path without relic

### Synergy scorecard (per new relic/spell)

| Question |
|----------|
| Enables a prior pick? |
| Enabled by something in the pool? |
| Payoff delay (setup turns)? |
| Fight shape (1v1 vs 3v1)? |
| Color commitment? |
| Orphan without combo? |
| Anti-synergy with another route? |

**Target mix:** ~30% glue, ~40% build direction, ~20% payoff, ~10% clutch/rare.

---

## Relic × spell interaction matrix (high level)

Legend: **+** strong, **~** neutral, **−** anti, **∅** no interaction

|  | Ignite | Skewer | Surge | Bulwark | Volley | Shatter |
|--|--------|--------|-------|---------|--------|---------|
| Sharp Edge | + | + | + | ~ | + | + |
| Cascade Crystal | ~ | + | **+** | ~ | ~ | **+** |
| War Drum | + | + | + | + | + | + |
| Iron Buckler | ~ | ~ | ~ | **+** | ~ | ~ |
| Afterburner | −? | −? | ~ | ~ | **−** | ~ |
| Avalanche | ~ | + | **+** | ~ | ~ | + |

Volley + Afterburner: both want red pool at EOP — fix Afterburner first, then decide if they should stack or exclude.

---

## Implementation checklist (when executing)

1. `MANA_CAPS` + tests
2. `src/content/spells.tsx` costs + any affordability tests
3. Smoke: Knight starter fight, mid-run hoard, shop/reward cast
4. Fix Afterburner phase-end ordering (same PR or follow-up)
5. Update `10-shipped-content-catalog.md` cost column after ship
6. Playtest script: cascade run / block run / burn+skewer run — “was there a setup→payoff turn?”

---

## Open questions

1. **Phase 1 vs 1b:** modest step first, or go straight to PQ-aligned caps (~18) + 6-floor?
2. **Starter gentleness:** discounted costs (5), starting mana bundle, or lower cap until first rest?
3. **Hybrid Ignite:** `6R` (simple) vs `4R+2Y` (PQ routing) — which reads better in tray?
4. **Persist mana across fights:** at cap 18, carry-over snowball is stronger — decay 1–2 per fight or post-boss wipe?
5. **Stat-scaling caps (PQ mastery):** fixed 18 for slice vs relic “+max mana” progression?
6. **Free-cast tax:** do we need costs **above** PQ (7–8) for top spells because spells don’t consume the turn?

---

## Doc drift

When implemented, update:

- `PLANNING/10-shipped-content-catalog.md` — spell cost table
- `PLANNING/08-multi-color-mana-proposal.md` — cap values (historical; add pointer to this doc)
- `PLANNING/00-decisions-so-far.md` — one-line “balance pass locked” entry if numbers are committed
