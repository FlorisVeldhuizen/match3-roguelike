# Puzzle Quest — ideas worth stealing

Status: **Draft notes, not locked.** Captures a design pass that re-examined Renza's combat through the lens of Puzzle Quest's turn / spell / resource mechanics (session: 2026-05-24). Four ideas walked one-by-one; directions chosen below need pressure-testing against existing systems before any of them touches code.

Companion to `01-design.md` — does not override anything there. When an idea here gets locked, it migrates into `01-design.md` (or its own `0X-…md` doc) and `00-decisions-so-far.md`.

---

## Puzzle Quest, in one paragraph

Strict alternation, shared board, every gem is a resource. Skulls → free damage to the opponent. Coloured gems → coloured mana banks that fund spells with mixed-colour costs. Match-4 = extra turn, match-5 = extra turn + extra reward. Spells are *the* depth lever — most don't just deal damage, they *edit the board* (convert all of one colour to another, destroy a row, transform skulls, etc.). That folds the spell layer back into the matching layer.

What Renza already shares with PQ:
- 5 colours, 5 distinct roles (red/blue/green/yellow/purple)
- 4+ match → +1 turn, capped at 1 per swap (`pools.ts:38`)
- Match-5 is "special" — flags cleared cells as `blessed` (delayed payoff via `01-design.md` §Blessed cells)
- Enemies act on the board, not just on stats (`01-design.md` §Enemies share the board)

What Renza does *not* have, that PQ does:
- Spells that edit the board (all current spells are stat-effects)
- Mixed-colour spell costs (only yellow funds spells)
- A "skulls"-style decoupling of damage-fuel from spell-fuel

---

## ✏ Idea #1 — Board-editing spells in the Knight's kit

### Decision
Extend the Knight's kit with 1–2 board-editing spells. Reuse existing `burning` / `blessed` cell flags wherever possible. Knight stays defensive in identity, but gains at least one spell that pushes back on the board (not just on stats).

### Rationale
Per `01-design.md` §"Parallel play" — pawfessor flagged that player abilities live on the stat sheet while enemy abilities live on the board, which makes encounters feel like score thresholds instead of puzzles. That doc already lists `Cleanse / Transmute / Bomb-tile / Sweep / Freeze counter` as candidate player board verbs, but parks them in "the relic/spell pool, not the class baseline." This idea promotes one or two of them into the *Knight class baseline* so the asymmetry isn't load-bearing on relics.

### Engine surface needed
Current spell delivery is "cast → queue into `pendingSpells` → resolve at EOP" (`turn.ts:49-145`). Board-editing spells need an **instant-effect path**: resolve on cast, mutate the board immediately, so the player can match into the result this same phase.

Likely additions:
- `instantEffect` branch in the spell registry (alongside the EOP-queued branch).
- A small vocabulary of board verbs in `core/board/`:
  - `flagCells(positions, flag, duration)` — set `burning` or `blessed` outside of normal triggers
  - `convertColor(from, to)` — transmute, does not trigger matches
  - `clearLine(row | col)` — gravity + cascade follows
  - `shuffle()` — already exists for no-moves, could be exposed
- Decision: do board-edits trigger cascade resolution, or just rearrange and wait for the player's next swap? PQ triggers; the spicier option but power-budget hazard.

### Candidate Knight spells (in increasing engine cost)
| Name | Cost | Effect | Engine cost |
|---|---|---|---|
| **Kindle** | 2–3 mana | Flag 3 random cells as `burning` for 2 phases | Tiny — reuses `burning` flag |
| **Cleanse** | 2 mana | Strip all `burning` flags from the board | Tiny — flag clear |
| **Transmute** | 4–5 mana | Convert all gems of colour X → colour Y, no cascade | Medium — new verb, no cascade trigger |
| **Bless** | 3 mana | Place 2 `blessed` flags on chosen cells | Medium — reuses flag, needs targeting UI |
| **Avalanche** | 7–8 mana | Clear a column; gravity + cascade follow | High — power-budget review needed |

Kindle is the cheapest first step — reuses the existing `burning` flag and tile-burn match payouts, no new engine verbs.

### Open questions
- Does Kindle (or whichever spell ships first) replace one of {Bulwark, Reinforce, Riposte}, or extend the kit to 4? Knight currently has 2 spells + 1 ultimate by `01-design.md` design.
- Cell targeting: random, player-chosen, or rule-based (e.g. "3 cells of the chosen colour")? Targeted UI is more interesting but adds a new selection mode.
- Should board-edit casts trigger matches when they happen to land on a triple? Probably no for transmute (player makes the next move), yes for line-clear spells.

### Risks
- **Power creep on cascades.** A spell that triggers matches *is* a free cascade. Easy to over-tune.
- **Knight identity drift.** If Knight becomes "blue defender + fire-starter," that may dilute the class read. Consider whether board verbs should be neutral utility or themed to blue/defence (e.g. "Frost: flag 2 cells as un-matchable for 1 turn").

---

## ✏ Idea #2 — Mixed-colour spell costs (soft version)

### Decision
Red, blue, green keep their existing immediate effects (damage / block / heal). They *also* drip a small amount into a per-colour **spell bank**. Future spells can have mixed-colour costs (e.g. `4 yellow + 2 red`). Yellow remains the primary spell currency; purple remains ultimate charge.

### Rationale
PQ's spell-cost-by-colour creates colour-routing decisions: every match is also a vote for "which spell am I charging." Renza already has colour-as-role (red = damage, blue = block, etc.) but not colour-as-cost. Adding the latter without removing the former preserves the legibility of "match red → HP drops" while opening a second dimension.

This idea unlocks class differentiation that the slice doesn't currently have a lever for: Knight spells cost blue, future Mage spells cost red+yellow, future Berserker spells cost red+red, etc. The *cost colour* expresses identity.

### Engine surface needed
- Extend `Player` with a `spellBanks` field (or extend `phasePools` to persist across phases for the spell-bank portion). Open question on which.
- Drip rate per match: probably `floor(matchSize / 2)` or a flat `+1`. Tunable in `content/`.
- Spell-cost type changes from `manaCost: number` to `cost: { yellow?: number, red?: number, ... }` in `spellRegistry.ts`.
- UI: each colour bank needs a pip readout. Five pips is the upper bound of what should fit; the existing chip rule ([[feedback-status-chips-single-number]]) applies — one number per pip.

### Tension with existing systems
- **Resolute** scales on "no blue matched this phase." If blue matches also drip into a blue spell-bank, the counter logic doesn't change, but the player may feel more reluctant to skip blue. Probably fine.
- **Bulwark** consumes the blue pool for attack. Does it also consume the blue spell-bank drip? Default: no, the bank drip already happened at match time and is separate from the EOP pool.
- **Yellow vs colour banks.** Yellow is the universal currency; coloured banks are spell-specific. Two-tier system. Risk: muddled mental model. Mitigation: keep at least one Knight spell on yellow-only so the simple path exists.

### Open questions
- Drip rate and ceiling. PQ has no bank cap; should Renza?
- Do spell-bank drips compose with cascade multipliers and blessed flags? Default: yes, same scope as pool deltas (`01-design.md` §Multiplier scope), but worth confirming.
- Does the existing `phasePools` get extended to be persistent for the bank portion, or is `spellBanks` a separate field that survives across phases while `phasePools` continues to zero? Architectural call.

### Risks
- **UI density.** Five pip readouts plus the existing mana/charge pips plus the pending-effects strip is a lot of HUD furniture.
- **Tuning.** Drip rate × spell costs × multipliers × banks-can-cap-or-not is a 4-axis tuning problem.

---

## ✏ Idea #3 — Extra-turn mechanics

### Decision
**Leave alone.** Current behaviour (4+ → +1 turn capped at 1 per swap; line-5 → +1 turn + `blessed` flag) is sufficient and well-tuned.

### Rationale
- Cap of 1-per-swap prevents runaway turns that would starve enemy intents of airtime — already documented as a `01-design.md` constraint.
- Match-5 differentiation already lives via `blessed`, which is a setup→payoff loop rather than an immediate burst. Adding an additional extra-turn reward to size-5 would compound with cascades into chaos.
- T/L shapes already have their own reward (area clear). Borrowing Bejeweled's "T plants blessed, L plants burning" was considered and rejected here — feels like solving a problem that doesn't exist.

No engine changes.

---

## ✏ Idea #4 — Enemy-placed bomb tiles (encounter-specific)

### Decision
Do **not** add skulls as a 6th gem type. Instead: introduce a new enemy archetype (or extend an existing one) whose intent is to **place bomb-tiles on the board** that must be matched within N turns or detonate for damage. Encounter-specific, not a universal mechanic.

### Rationale
PQ's skulls solve two problems:
1. Decouple damage-fuel from spell-fuel (which idea #2 already addresses, partially).
2. Make the board itself a threat surface (unmatched skulls become opponent ammunition).

Problem (2) doesn't translate cleanly to Renza's single-board model — there's no shared board for "leaving a skull unmatched" to feed an opponent. But the *spirit* of (2) — "the board has stuff on it that's dangerous if ignored" — does translate, and Renza already has the architecture for it via `CellFlags`. The Smolder archetype's `tile-burn` intent is the existing template: a specific enemy plants threat-tiles via a telegraphed intent, and the player must clear them.

A bomb-tile is the more punishing sibling of `tile-burn`. Where burning damages on match, bomb-tiles damage if *not* matched in time. Detonation pressure instead of clearing pressure.

### Engine surface needed
- New `IntentKind` value (e.g. `'tile-bomb'`).
- New `CellFlags` entry: `bomb?: number` (turns until detonation).
- Tick handler: at end of player phase (or start, TBD), decrement `bomb`; on 0, detonate (damage player, clear cell).
- Match handler: matching a bombed cell defuses it (clears the flag), and possibly grants a payoff (refund mana? small heal? deal damage to the placer?).
- Visual + audio cues consistent with the existing `tile-burn` system (telegraph during enemy turn, persistent visual on the cell, escalating warning as detonation approaches).

### Owning archetype
Open question whether this lands on a new archetype or extends an existing one. Candidates:
- **New archetype** — "Sapper" or similar. Pure board-threat enemy. Clean.
- **Extends boss verb** — `01-design.md` lists "Petrifier / Corruptor / Wall" as boss-gimmick candidates; bomb-tiles could be a fourth.
- **Extends Smolder** — already plants tiles; bomb-tile is a heavier variant. Risks over-loading one archetype.

Probably new archetype, since the threat model is meaningfully different from burning (defuse vs. clear-on-match).

### Open questions
- Detonation damage scaling — flat per bomb, or scales with turn count survived?
- Does matching a bomb give the player a payoff, or just defuse it? Payoff makes the verb feel rewarding; pure-defuse keeps it as pressure-only.
- Stacking: can one cell be both bombed and burning? `CellFlags` currently treats `burning` and `blessed` as mutually exclusive (1 flag per cell). Bombs probably need the same exclusivity, which means a cell already burning can't be bombed (skip the placement, or pick a different cell).
- Interaction with `blessed` flag: matching a blessed-AND-bombed gem — does the 2× apply to the defuse payoff?

### Risks
- **Yet another flag.** The cell-flag system is now carrying burning, blessed, and potentially bomb. Architecturally fine (1-bit slots), but the player UI has to communicate three different cell states clearly.
- **Pressure spiral.** If bombs and burns can co-occur on the board, the player can lose to flag-tick damage they have no time to clear. Tuning needed.

---

## Composition notes

The four decisions interlock:

- **#2 enables #1**: mixed-colour costs make new Knight spells like Kindle (cost: red) feel different from Bulwark (cost: blue). Without #2, every new spell is "yet another yellow-cost button."
- **#1 doesn't block on #2**: a first board-editing spell can ship on yellow-only mana to prove the engine path, then migrate to a coloured cost when #2 lands.
- **#4 is independent**: a new enemy archetype with bomb-tile intents doesn't depend on either spell-system change. Could ship in any order.
- **#3 is a no-op**: no work, no dependency.

Suggested sequencing (when any of this leaves draft):
1. Spec #2 in `01-design.md` (engine + UI design for spell banks).
2. Implement #2's engine surface (banks, mixed-cost spell registry).
3. Ship #1's first spell (Kindle or similar) on the new cost system.
4. Spec #4's new archetype + bomb-tile flag.
5. Implement #4 once #1 has been playtested.

But all of this stays draft until each idea passes a tension-check pass and gets migrated into `01-design.md` proper.
