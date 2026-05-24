# Proposal: Multi-color mana economy

Status: **Approved — to implement before any spell expansion.** Affects `01-design.md` (combat resources), `02-scope.md` (gem identity), `04-roadmap.md` (insert new phase).

## Why this exists

Today our colors are isolated single-purpose tracks:
- R / B / G → resolve at EOP (damage / block / heal)
- Y → mana (immediate credit, spell cost currency)
- P → ultimate charge (immediate credit, ultimate cost)

That leaves **3 of 5 colors with no spell-economy participation**. Match red? Just damage. Match blue? Just block. The match-3 board doesn't function as a multi-resource economy, which is the genre staple every successful match-3 RPG leans on (Pazudora, Puzzle Quest, MPQ, Roguematch).

Before we expand the spell roster, we should put every color to work. Otherwise we're designing spells against a thin one-pool economy, which forces awkward retrofits later. **Better to land the richer resource system first, then design spells against it from day 1.**

## The model

**Each match contributes to two parallel tracks:**

| Color | Immediate / EOP effect (unchanged) | NEW: persistent color mana |
|---|---|---|
| Red | Damage at EOP | +red mana (capped 8) |
| Blue | Block at EOP | +blue mana (capped 8) |
| Green | Heal at match-time | +green mana (capped 8) |
| Yellow | (was single mana pool) | **Wild mana** (capped 5) — substitutes for any color at 1:1 |
| Purple | Ultimate charge (unchanged) | (no color mana — keeps single-purpose identity) |

A red 3-match deals 3 damage **and** adds 3 red mana. A blue 4-match grants block + extra-turn **and** adds 4 blue mana. The two tracks are independent — spending mana never reduces the immediate effect, and the immediate effect never drains mana.

### Wild mana (yellow) — the flex resource

Yellow becomes "wild mana." Any spell cost can be paid with yellow at **1:1 substitution**. So if Bulwark costs `3 blue`, you can pay it as:
- 3 blue mana
- 2 blue + 1 yellow
- 1 blue + 2 yellow
- 3 yellow

Yellow is capped lower (5) than colored manas (8) so it doesn't dominate the planning layer — it's a flex resource, not a primary one.

### Purple stays single-purpose

Purple keeps its identity as the ultimate-charge color. It does NOT generate purple mana for spells. Two reasons:
1. Ultimates are already heavy commitments; mixing them with the spell economy muddies the role
2. Keeps a clear divide: spells cost color mana; ultimates cost purple charge

### Caps and refresh

- **Color manas (R/B/G) cap at 8.** Past the cap, additional matches still produce the immediate effect but the mana doesn't accumulate.
- **Wild mana (Y) caps at 5.** Lower cap because it's universally useful.
- **Manas persist across phases AND across fights within a run.** Like the current yellow mana — once stored, they survive between fights.
- **Restart wipes all mana.** Same as today.

The persistent-across-fights rule matters for run pacing: you finish a fight with leftover mana you couldn't spend, and you carry it into the next encounter. Encourages spending but doesn't punish surplus.

## Spell cost shape

New type:

```ts
export type ManaCost = {
  red?: number
  blue?: number
  green?: number
  yellow?: number  // when explicitly required, not as wild substitution
}
```

A spell with `cost: { blue: 3 }` requires 3 mana that resolves to blue — either 3 blue mana, or some mix using wild substitution.

A spell with `cost: { yellow: 2 }` requires *yellow specifically* (no substitution accepted). Reserved for spells that thematically want wild mana as the primary input (e.g., a "Focus" spell that converts between colors).

Most spells will be single-color (`{ red: 4 }` or `{ blue: 3 }`). Two-color costs (`{ red: 2, blue: 1 }`) exist for **hybrid spells** that thematically blend offense and defense — these are an interesting design seam but probably J2 content, not slice.

### Existing spell updates

The 2 existing spells get color costs:

| Spell | Today | With multi-color mana |
|---|---|---|
| **Bulwark** | 3 mana | **3 blue** |
| **Reinforce** | 4 mana | **4 blue** |
| **Riposte** (ult) | 8 charge | **8 purple charge** (unchanged) |

Both Knight spells are blue-identity, so they cost blue. The blue pool they *operate on* (Bulwark converts blue pool to attack) is unaffected — that's still the at-EOP resolution mechanic.

The slight oddness — "Bulwark needs blue mana to cast AND blue pool to operate on" — works out naturally because they're earned in parallel from the same matches.

## HUD impact

Today the HUD shows: HP, block, mana (number), ultimate charge, pool indicators during phase.

New: HUD shows HP, block, **R/B/G/Y mana indicators (4 small chips)**, ultimate charge, pool indicators during phase.

Design intent:
- Mana chips are small, color-coded, sit near each other (top-right or under HP, TBD)
- Each chip shows current value and cap (e.g., "3/8")
- Wild (yellow) chip visually distinct (rainbow border, sparkle FX, etc.) to communicate the "substitute" rule
- Capped manas pulse softly to nudge "spend me"

## Implementation surface

Engine work:
- `Player.mana: number` → `Player.mana: { red: number, blue: number, green: number, yellow: number }`
- New `ManaCost` type in `src/types/index.ts`
- New `MANA_CAPS` constant: `{ red: 8, blue: 8, green: 8, yellow: 5 }`
- Match-walker (`attemptSwap`): for each match, add to color-specific mana pool (respecting cap)
- Spell affordability gate (`castSpell` in store): check `ManaCost` against current mana pools, with wild substitution
- Spell consumption: deduct from color-specific pool, prefer exact-color matches before consuming wild

Affordability + consumption logic (the trickiest bit):
- For a cost like `{ blue: 3 }`:
  - Use up to 3 blue mana, then top up shortfall from wild yellow
  - Affordable iff `blue + yellow >= 3`
- For a cost like `{ red: 2, blue: 1 }`:
  - Use exact-color first, then wild
  - Affordable iff `(red >= 2 || red + yellow >= 2) && (blue >= 1 || blue + yellow >= 1) && (red + blue + yellow >= 3)` — careful: yellow can't double-count between requirements
- Use a greedy consumption: pay exact colors first, then wild for shortfall

Content work:
- Update Bulwark + Reinforce cost shape
- Update spell registry type signatures
- Spell-cast UI: spell button disabled if not affordable; affordability calc reads multi-color mana

Test work:
- 154 tests, many touch mana. Updates expected to be:
  - `mana: 5` → `mana: { red: 0, blue: 5, green: 0, yellow: 0 }` (or similar)
  - Phase-start mana state assertions
  - Spell-cast affordability tests get more variants

HUD work:
- Render 4 mana chips (replacing 1 generic mana counter)
- Cap-display logic
- Cap-pulse animation (Phase L territory; ship the static version first)

**Total estimate: 6-9 hours.** Smaller than I'd feared because the existing yellow → mana plumbing extends cleanly; we're widening it, not rebuilding.

## Locks

| Decision | Value |
|---|---|
| Number of color manas | 4 (R/B/G/Y); P stays charge-only |
| Wild mana | Yellow, 1:1 substitution for any cost |
| Caps | R/B/G = 8 each; Y = 5 |
| Persistence | Across phases, across fights within a run; wiped on restart |
| Spell cost shape | `{ red?, blue?, green?, yellow? }`; yellow explicit only when required |
| Bulwark cost | 3 blue |
| Reinforce cost | 4 blue |
| Riposte cost | 8 purple charge (unchanged) |
| HUD | 4 mana chips + ultimate charge |

## Open (decide during implementation or playtest)

1. **Mana cap tuning.** 8/8/8/5 is a starting point. Playtest may push these up or down.
2. **HUD chip placement.** Top-right cluster vs. under-HP row vs. dedicated mana bar. UI mockup needed.
3. **Cap-pulse FX.** Polish-pass aesthetic; Phase L.
4. **Two-color spell costs.** Exist in the type signature; defer all two-color spells to J2 content.
5. **Mana cap relics.** "Increase blue cap by 4" type relics are a J2 content seam.

## Roadmap impact

Insert as new phase, replacing the old H2 multi-enemy spec since this proposal supersedes the AP / multi-hit / AOE-gem alternatives:

```
... → H2a (multi-enemy plumbing, shipped) → H2b (Brute + Defender verbs) → H2c (Caster + Swarmer verbs)
   → [NEW] H3 (multi-color mana economy)
   → [NEW] H4 (spell roster expansion + ally-target intents + hero power)
   → I → J1 → J2 → K → L
```

H3 (this proposal) lands before H4 (spell expansion) so spells are designed *in* the multi-color system from day 1.

## What this supersedes

- `07-action-points-proposal.md` → parked. AP solved multi-enemy by widening *swap budget*; multi-color mana solves it by widening *resource economy*. The latter is more genre-native and less disruptive.
- AOE gems / multi-hit / persistent power gems → all parked. The slice's answer to multi-enemy is *spell variety on a multi-color economy*, not a board mechanic.
- "Drop multi-enemy" → not necessary. Multi-color mana + spell expansion makes multi-enemy interesting.
