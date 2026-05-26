# Board-effect pipeline

Checklist for adding a new board verb (enemy or player). Derived from the verbs that shipped through Phase F → H2c (Burn, Column-smash, Petrify-row, Color-hex, Cluster-shove) and the polish pass that followed. Each step exists because we learned, the hard way, that skipping it causes a specific symptom — those symptoms are noted inline so future-you knows what's at stake.

Verbs are the single biggest source of cross-file work in this codebase; touching one layer without the others either dead-ends ("the resolver fires but nothing shows up") or feels broken ("the wash appears before the particles arrive"). Walk the list end-to-end before declaring a verb shipped.

---

## 1. Types & state shape (`src/types/index.ts`)

- **`IntentKind`** — add the new kind to the union.
- **`Intent`** variant — fields the roller produces at telegraph time so the resolver can fire deterministically (column for smash, row for petrify, sources+destinations for shove, color for hex).
- **`GameEvent`** kinds — the standard set every board verb needs:
  - `x-placed` — telegraph emitted at the *previous* turn's end; overlay shows the warning treatment.
  - `x-fired` — resolution event emitted when the verb actually fires; overlay flips from pending → active *at trail arrival*, not immediately.
  - `x-ticked` (if duration-based) — emitted at phase boundary by the tick helper; carries `remaining` (0 = just expired).
  - `x-triggered` (if the verb has a player-interaction beat — e.g. matching a burning cell, matching a hexed colour) — surfaces the interaction so FX/SFX layers can react.
- **State location** — pick once and stick with it:
  - **Per-cell** (`CellFlags`) when the verb attaches to specific positions and should travel with gems under gravity: `burning` (Smolder), `pendingShove` (Swarmer).
  - **Board-level map** (`BoardState`) when it's positional but cell-agnostic: `petrifiedRows` (Defender — row index → turns left).
  - **Fight-level list** (`FightState`) when it's board-wide and not tied to positions: `hexedColors` (Caster — colour → turns left).
- **`ArchetypeDef`** new fields (`core/combat/archetypeRegistry.ts`) for tuning knobs: durations, magnitudes, counts (e.g. `colorHexDuration`, `clusterShoveLength`).

**Symptoms of skipping this step:** TS errors in the dispatcher switches will catch most omissions, but missing GameEvent kinds slip through silently because the AC/HUD/SFX subscribers all default to no-op on unrecognised kinds.

---

## 2. Engine plumbing (`src/core/combat/`)

- **Roller** in `intentRollers.ts` — `rollXIntent(def, rng)` returning `{ intent, rng }`. Use the appropriate RNG stream (`rng.enemy` already routed via `rollIntent`).
- **Dispatcher case** in `intents.ts:rollIntent` switch — add the kind.
- **Telegraph application** in `intents.ts:applyIntentTelegraph` — pre-flag cells if the verb is counter-playable (matching the flagged cells before fire should cancel that part of the effect). Always emit the `x-placed` event for the overlay.
- **Resolver** in `intentResolvers.ts:resolveXIntent` — writes the active state, emits `x-fired`. Pure function returning patches.
- **Dispatch in `enemyTurn.ts:executeEnemyTurn`** — add the resolver call and thread any cross-cutting state (board, rng, petrifiedRows, hexedColors, …) through the `EnemyTurnResult`.
- **Per-phase tick** in `flags.ts:tickXState` (or analogous) — decrement durations, drop expired entries, emit `x-ticked`. Call from `actions/swap.ts` **before** `executeEnemyTurn` so a new entry placed this turn keeps its full specced duration.
- **Match-side effect** (if applicable) — hook into `cascadeProcessor.ts` after `match-found` to react to the player's matches (Burn from board-cells, Weak from hex match). Threaded as a read-only parameter; the cascade processor owns the player-state mutation.
- **`freshFight`** in `actions/helpers.ts` — initialize the new state field to its empty default.

**Symptoms of skipping this step:** verb fires but state doesn't update; tick doesn't run so duration goes infinite; match-side effect missing means the verb has no teeth.

---

## 3. AnimationController particle trail (`src/pixi/AnimationController.ts`)

- **Palette + core constants** — define once at the top of AC: a small palette array of hex colours + a brighter core hex. Pattern from `FLAME_PALETTE`/`FLAME_CORE_HEX`. Pick colours that read against the gem palette (avoid red gem ↔ red ember collisions).
- **Event handler** — add a case in `playEvent` for `x-fired` that calls `spawnVerbToCellsTrail(enemyId, cells, palette, core)`. For verbs whose event payload doesn't carry cells (e.g. color-hex targets a colour, not positions), read the live board from `useGameStore.getState().board.cells` at fire time and compute the cell list.

**Symptoms of skipping this step:** verb fires silently (no particles emitted from the caster) — the overlay treatment appears with no "where did this come from" hand-off.

---

## 4. UI overlay (`src/ui/components/XOverlay.tsx`)

The pattern that took multiple iterations to land:

- **Event-driven local state** — NOT direct `useGameStore` read of the verb's state. Reason: the store commits synchronously at swap time, but the AC plays events on its own timeline, so a store-derived overlay flashes the visual at swap-commit (before particles arrive) rather than at chip-arrival.
- **Subscribe to placed** → add to `pending` local state (warning treatment, distinct palette/pattern from active — see `.petrify-cell.is-pending` for the amber-stripe convention).
- **Subscribe to fired** → schedule the active-state transition via `window.setTimeout(..., TRAIL_ARRIVAL_MS)`. **Guard with `useGameStore.getState().fightCounter`** so a stale timeout doesn't leak the verb into a fresh fight if the caster died or the player won during the trail flight.
- **Subscribe to ticked** → update `turnsLeft` for the affected entry. On `remaining === 0`, enter `is-expiring` state for `FIZZLE_MS` (1200ms), then drop. On `remaining === 1`, render with `is-weakening` so the player sees "this is about to release."
- **Seed from store** on mount + fight reset. The store snapshot is authoritative for "what's currently active"; events catch up only what happens *during* the session.
- **Mount in `App.tsx`** alongside other overlays inside `.board-mount`.
- **CSS** in `src/styles/threats.css` with consistent state class names: `.is-pending`, `.active`, `.is-weakening`, `.is-expiring`. Each verb gets its own palette but shares the state-class vocabulary so future polish passes can reason about the four states without per-verb digging.

**Symptoms of skipping this step:**
- Store-derived overlay → visual lands before particles arrive ("looks buggy").
- No `fightCounter` guard → ghost effects in a fresh fight after a killing-blow swap.
- No `is-weakening` → the verb expires "out of nowhere" with no telegraph.
- No `is-expiring` fade → cells pop out of existence on the tick frame.

---

## 5. SFX bindings (`src/audio/`)

- **New synth file** `synths/x.ts` exposing three variants (not all required, but the slots are):
  - `playXApplySfx()` — the apply moment. Wired in `bindings.ts` via `scheduleAtTrailArrival(() => playXApplySfx())` for the `x-fired` event so sound, visual, and chip all sync at TRAIL_ARRIVAL_MS.
  - `playXTriggerSfx(magnitude?)` — the player-interaction moment (matching a flagged cell, matching a hexed colour). Fires inline at event time — no delay; the player just triggered it.
  - `playXExpireSfx()` — release cue. Wired for `x-ticked` with `remaining === 0`.
- **Update `bindings.ts`** — import the synths and add cases for each event. Comment each binding with *why* the timing is what it is (delayed vs inline) — these decisions are easy to undo if not explained.

**Symptoms of skipping this step:** verb is silent (audibly indistinct from a status apply); or wrong timing — sound fires at swap-commit while the visual lands 700ms later.

---

## 6. Map gen + content (`src/core/map/generate.ts`, `src/content/enemies.ts`)

- **Register archetype** in `content/enemies.ts` with stats, pattern, and any new ArchetypeDef fields.
- **Add to `EnemyArchetype` union** in types.
- **Column weights** in `COLUMN_ARCHETYPE_WEIGHTS` — decide which tiers the archetype debuts in. New verbs should NOT live in column 0 (the early-curve on-ramp); debut in column 1 at low weight, full weight by column 2.
- **Role-mixed compositions** in `ROLE_MIXED_COMPOSITIONS` if the archetype pairs well with existing ones (e.g. `caster+rallier` — debuff carrier protected by a buffer).
- **Dev panel** in `src/ui/components/SettingsPanel.tsx` — add a "Force fight" button so future-you can test the verb in isolation without seed-fishing.

**Symptoms of skipping this step:** the archetype exists in code but the player never encounters it in a real run; or it shows up but the encounter mix feels off (always paired the same way).

---

## 7. Intent display (`src/content/intentDisplays.tsx`)

- Add a `case 'x'` returning `{ icon, number?, label, description }`. The board overlay shows the spatial details; the badge stays compact. For board-wide verbs (color-hex) the badge is the player's only signal during the telegraph turn, so the description has to be unambiguous.

**Symptoms of skipping this step:** TypeScript catches it (exhaustive switch). But weak description text means players don't understand what the verb does until they eat it once.

---

## 8. Tests (`src/core/combat/h2*.test.ts` pattern)

Per verb, cover:
- **Roller** — produces valid intents under varied RNG (in-bounds, no overlap for multi-cell verbs).
- **Telegraph** — emits the `x-placed` event; pre-flags cells if applicable; board reference preserved when no mutation needed.
- **Resolver** — writes the active state; emits `x-fired`; refresh / max / additive rules respected for re-application.
- **Tick** — decrements correctly; expires at 0; emits `x-ticked` events.
- **Counter-play** (if applicable) — clearing the flagged cell before fire denies that part of the verb.
- **Match-side effect** (if applicable) — applies the right magnitude with the right semantics (additive vs refresh — see the H2c Weak stacking decision in `04-roadmap.md`).
- **Map-gen distribution** — archetype appears within a reasonable seed sample.

**Symptoms of skipping this step:** regressions when the next verb's refactor touches the shared pipeline. The 22-test H2c suite caught three subtle bugs during the polish pass — worth the half-hour.

---

## Quick "did I do everything?" matrix

| Layer | File | What's added |
|-------|------|--------------|
| Types | `src/types/index.ts` | IntentKind, Intent variant, GameEvent kinds, state-bag field |
| Archetype def | `src/core/combat/archetypeRegistry.ts` | New tuning fields |
| Roller | `src/core/combat/intentRollers.ts` | `rollXIntent` |
| Roll dispatch | `src/core/combat/intents.ts` | case in `rollIntent` switch |
| Telegraph | `src/core/combat/intents.ts` | branch in `applyIntentTelegraph` |
| Resolver | `src/core/combat/intentResolvers.ts` | `resolveXIntent` |
| Turn dispatch | `src/core/combat/enemyTurn.ts` | case + state threading |
| Tick | `src/core/board/flags.ts` | `tickXState` |
| Tick wiring | `src/core/state/actions/swap.ts` | call before `executeEnemyTurn` |
| Match side-effect | `src/core/combat/cascadeProcessor.ts` | read-only state param + post-match hook |
| Fresh fight | `src/core/state/actions/helpers.ts` | initialize state field |
| Particle palette | `src/pixi/AnimationController.ts` | `X_PALETTE` + `X_CORE_HEX` |
| Particle trail | `src/pixi/AnimationController.ts` | `case 'x-fired'` → `spawnVerbToCellsTrail` |
| Overlay | `src/ui/components/XOverlay.tsx` | event-driven, TRAIL_ARRIVAL_MS delay, fightCounter guard, four-state classNames |
| Overlay CSS | `src/styles/threats.css` | `.x-cell.{is-pending, active, is-weakening, is-expiring}` |
| Overlay mount | `src/ui/App.tsx` | mount in `.board-mount` |
| Synths | `src/audio/synths/x.ts` | apply / trigger / expire |
| SFX bindings | `src/audio/bindings.ts` | scheduled apply, inline trigger, expire |
| Archetype | `src/content/enemies.ts` | `registerArchetype(x)` |
| Map weights | `src/core/map/generate.ts` | column weights + compositions |
| Intent display | `src/content/intentDisplays.tsx` | case for badge + tooltip |
| Dev panel | `src/ui/components/SettingsPanel.tsx` | Force-fight button |
| Tests | `src/core/combat/hX.test.ts` | roller / telegraph / resolve / tick / counter-play / match-effect |

That's the whole list. If the new verb ships without any one of these, expect a follow-up commit within the week.
