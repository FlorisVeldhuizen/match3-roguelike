# Decisions locked in

These are settled. Anything in `01-design.md`, `02-scope.md`, `03-architecture.md` is a working draft.

## Concept
Match-3 roguelike — turn-based combat (Puzzle Quest lineage) crossed with Balatro-style run modifiers that warp the rules each run.

## Tech stack
- **React** for UI, menus, HUD, modals
- **PixiJS** on Canvas for the board (gems, animations, particles)
- **TypeScript** throughout
- Seeded RNG (run reproducibility, replay-friendliness)

## Scope target
**Playable vertical slice.** One full run, start to finish. Not a full game.

## Workflow
Plan-first. We write design + architecture docs in `PLANNING/`, lock them, then execute in phases.

## Art direction
Stylized but simple. Custom SVG gems, simple enemy sprites, juicy match animations (squash/stretch, particles). Pixi earns its keep.

## Modifier scope
Full game wants all 4 modifier styles:
1. Scoring modifiers (gem-value tweaks)
2. Board-rule modifiers (rule changes — diagonal matches, gravity tweaks)
3. Combat-effect modifiers (match-triggered abilities)
4. Build/synergy modifiers (relic combos)

**Slice ships 2 of these: Scoring + Combat-effect.** Both attach via the same event-hook architecture — one engine, two content flavors. Board-rule and synergy modifiers are post-slice. (Locked in Phase 1.)

## Planning pipeline
- **Phase 0 — Game design** (`01-design.md`) — turn structure, gems, effects, run shape
- **Phase 1 — Scope lock** (`02-scope.md`) — exact content list, non-goals, "done" definition
- **Phase 2 — Architecture** (`03-architecture.md`) — state model, React↔Pixi boundary, match algorithm, RNG, save format
- **Phase 3 — Roadmap** (`04-roadmap.md`) — ordered implementation phases, each with runnable end-state
- **Phase 4 — Execute** — separate sessions, one phase at a time

## Locked-in after planning review (2026-05-22)

Canonical rules and architecture choices that emerged from the docs review. Each is fully written up in the referenced doc.

**Turn / combat semantics (`01-design.md`):**
- "End-of-turn" = **end of player phase**. A 4+ match extends the phase but doesn't end it; pools, Resolute, Bulwark all fire once per phase.
- Block is the **wall waiting for the enemy**: blue resolves at end of phase, persists through enemy turn, zeroed at start of next phase *before* Resolute fires.
- Bulwark **trades** block for attack (consumes the blue pool; no defense from blue that phase).
- Reinforce **doubles** this phase's block on carry-over.
- Resolute **scales with blue drought**: +2 base, +1 per consecutive phase with no blue (cap +5). "No blue" = no blue *matched* this phase; Bulwark consuming the pool still counts as "matched blue" (counter resets).
- Riposte counters for the **full incoming pre-block damage**; charged for the *next enemy turn only* — if that turn has no attack, Riposte expires unused.
- Cascade / scoring multipliers apply to **all five pool deltas** (R/B/G/Y/P).
- Status re-application: **DoT stacks damage + refreshes duration; multiplier debuffs refresh duration only** (no multiplier stacking).

**Architecture (`03-architecture.md`):**
- `GameEvent[]` is a **side-channel**, not in `GameState`. Not persisted in saves.
- Relic engine uses a **registry pattern** so `core/` can stay isolated from `content/`.
- Cursed flag travels **with the gem** (gravity moves the whole Cell object).
- `state.pendingReward` holds the rolled relic offers so reward-screen reload doesn't diverge from the seed.

**Scope additions:**
- Phase B: 5 unique gem **shapes** (diamond/teardrop/leaf/star/hex) — accessibility shim at asset level.
- Phase D: pending-effects strip in HUD (visibility for cast-but-pending end-of-phase spells).
- Phase F: damage preview on hover (lands with statuses, since Vulnerable/Weak need to factor into the preview).
- Phase G: relic-pair property test (acquisition-order divergence for every pair).
- Phase H1: map node hover preview.
- Phase J1: Corruptor next-conversion preview glyph (warns about the 2 cells about to be cursed).
- Phase J2: shareable seed URL; relic ordering hints in descriptions (no drag-to-reorder); extend pair test to full pool.
- Phase L: opens with external playtest; spacebar fast-forward; battle log panel; first-encounter tooltips; combo counter overlay.

**Skipped:** next-next intent preview, replay viewer (post-slice), relic drag-to-reorder, run history panel, Bulwark-aware damage preview, death-streak pity nudge.

## Round 2 review lock-ins (2026-05-22)

- Hooks renamed `onTurn*` → `onPhase*`; `onPhaseStart`/`onPhaseEnd` fire once per phase, not per swap.
- **Bulwark + Reinforce same phase:** Bulwark wins. Blue pool consumed for attack, Reinforce doubles zero, mana not refunded (UI dims Reinforce icon when Bulwark queued).
- **Bulwark conversion:** `floor(blue / 2)` attack. Global floor rounding.
- **Riposte:** charged for the *next enemy turn only*. If that turn has no attack, expires unused.
- **Spell cast window:** any time the board is settled during the player's phase; each spell can be queued at most once per phase.
- **Resolute counter:** "no blue" = no blue matched this phase. Bulwark consuming the pool still counts as matched (counter resets).
- **Status tick:** once per owner's phase/turn-start; extra-turn cycles don't retick player statuses.
- **Damage source field:** `DamageSource = 'enemy-attack' | 'status-dot' | 'self-curse' | 'spell-cost' | 'environment'` on `damage-taken` / `damage-dealt` events. Thornmail / Mirror Plate filter to `enemy-attack`; Vulnerable amplifies only `enemy-attack`; Stoneheart `onFatalDamage` triggers regardless of source.
- **Player block:** per-phase. **Enemy block:** persistent until depleted. Asymmetric on purpose.
- **Rounding (global):** floor, via shared `applyMultiplier` helper.
- **Cascade multiplier table is content data** (`content/cascade.ts`), swappable by future relics.
- **RNG fork hash:** `cyrb53(rootSeed + ':' + streamName)`.
- **Board gen:** two-pass (de-match row-major → valid-swap check → fallback force-place pair, then de-match outside the forced segment). No shuffle loop.
- **RelicInstance** carries `runFlags` (Stoneheart) and `fightFlags` (Mirror Plate); `fightFlags` cleared by `onRoundStarted`.
- Player pools field renamed `pools` → `phasePools` for clarity (mana/charge live at top-level).
