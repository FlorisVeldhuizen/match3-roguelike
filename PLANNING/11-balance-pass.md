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

## Phase 1 proposal — raise caps, scale spell costs

**Intent:** Stretch the mana game (more carry between fights, more “save for a big turn”) while making each cast a **larger chunk** of that bar — so Ignite-like spells need more setup matches.

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

## Phase 2+ (after cap/cost land)

| Item | Type | Notes |
|------|------|-------|
| **Afterburner** | Bug | `resolveEndOfPhase` zeros `phasePools` before `onPhaseEnd`; Afterburner reads `phasePools.red` → likely **never fires**. Fix order, then evaluate power. |
| **Iron Buckler** | Copy | Description says “block at EOP”; hook adds **blue pool** per blue match. |
| **Volley** | Design | Defers **all** in-phase red damage; weak in 1v1. Consider partial defer or overkill split rules. |
| **Brittle / Regenerate / Thornmail** | Tune | Undertuned or orphan picks — see tiers below. |
| **Burn relic** | Content | Ignite strong partly because no burn build relic exists (Overcharge = Riposte only). |
| **Blessed relic** | Content | Match-5 + Blessed Ground have no relic hook (`onBlessedMatch` teased in design). |
| **Reward synergy hints** | UX | Subtle icon on offers (“↗ Cascade Crystal”) per `05-reward-ideas.md`. |

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

1. **Starter gentleness:** Bulwark 5B vs 4B and Ignite 5R vs 4R for fight 1 feel?
2. **Cap 12 vs 10:** 12 enables longer hoard; 10 is a softer change with same ×1.5 costs?
3. **Persist mana across fights:** still desired after larger caps (snowball risk)?
4. **Separate yellow cap growth:** keep wild at 6 while RGB → 12?

---

## Doc drift

When implemented, update:

- `PLANNING/10-shipped-content-catalog.md` — spell cost table
- `PLANNING/08-multi-color-mana-proposal.md` — cap values (historical; add pointer to this doc)
- `PLANNING/00-decisions-so-far.md` — one-line “balance pass locked” entry if numbers are committed
