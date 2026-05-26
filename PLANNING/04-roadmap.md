# Implementation roadmap

Status: **Phase H2c complete.** Working on I (Shop + rest, gold economy) next. H4 was split into H4a (spells, shipped) / H4b (ally-target intents + new compositions, shipped) / H4c (hero power, **DROPPED 2026-05-26** — the gap was real but not hero-power-shaped; parked verbs become discoverable-spell candidates instead; see H4c section). H2 was split into H2a/H2b/H2c (see the H2 section for the split note + rationale). After a long design exploration about multi-enemy fights, AP, AOE gems, and multi-hit attacks (see `07-action-points-proposal.md`, now parked), the actual answer was **(H3) multi-color mana economy** followed by **(H4) spell expansion + ally-target intents** — see `08-multi-color-mana-proposal.md`. H2b/H2c (board verbs) remain queued and now run next because the spell-economy + ally-intent work is in.

> **Phase G note (2026-05-23):** `MatchPayload` ended up *per-match* (single `Match` + cascade level), not the per-swap aggregated shape originally sketched in the architecture doc. Reason: Cascade Crystal needs cascade-level awareness *per match*, since a single swap can produce matches at different cascade levels (only level ≥1 multiplies). The change is engine-internal; the relic-author surface didn't shift.

> **Design update (2026-05-22):** *Enemies share the board* pillar added to `01-design.md`. Every identity enemy archetype now gets a **board verb** (column smash, color hex, row petrify, cluster shove, tile burn). Implications:
> - **Brute** shipped in Phase E without a board verb. Retrofit "column smash" is queued — either as a small dedicated retrofit between F and G, or folded into Phase H2 alongside the other archetypes. Decision pending.
> - **Phase H2** archetype work expands: each of Caster / Defender / Swarmer (and Smolder, already in F) needs its board verb designed, telegraphed, and wired through `Cell.flags`. Skirmisher stays pure-stat as connective tissue.
> - **Phase F's Smolder** should ship with its tile-burn verb included, not as a follow-up — the verb *is* the archetype's identity now.
> - **Phase J1 Corruptor** is unchanged in spec but reframed: it's the most extreme instance of the verb system, not a one-off mechanic.

Ordered build phases. Each phase ends at a **runnable, demoable state** in the browser. No phase is "done" until you can open it and use it.

Each phase has:
- **Goal** — what's playable when it's done
- **Scope** — what's built
- **Out of scope (for this phase)** — what's deliberately deferred to a later phase
- **Acceptance** — concrete checks before moving on

Phases are sized for "single-session" work (~2-4 hours). If a phase grows beyond that, split it.

---

## Phase A — Project setup & scaffolding

**Goal:** `npm run dev` opens a Vite app with React rendering a "Match-3 Roguelike" splash screen.

**Scope:**
- `npm create vite@latest` → React + TypeScript template
- Strict tsconfig (`strict: true`, `noUncheckedIndexedAccess: true`)
- ESLint + Prettier with reasonable defaults
- Install: `zustand`, `immer`, `pixi.js` (v8)
- Folder scaffold per architecture doc (empty placeholder files acceptable)
- Lint rule enforcing `core/` / `content/` / `ui/` / `pixi/` import isolation via `eslint-plugin-boundaries` (config per architecture §8)
- Initial commit

**Out of scope:** anything game-related. Just tooling.

**Acceptance:**
- ✓ `npm run dev` opens browser with splash
- ✓ `npm run typecheck` and `npm run lint` pass
- ✓ Strict mode rejects `any` and unchecked indexed access

---

## Phase B — Board rendering & input (no game logic)

**Goal:** an 8×8 grid of colored gems renders in Pixi. You can click two adjacent gems and they swap visually (no validation, no matching).

**Scope:**
- `core/board/generation.ts` — generate a random 8×8 board (no match-removal yet)
- `core/state/store.ts` — minimal Zustand store with `{ board: Cell[][] }`
- `pixi/BoardScene.ts` — render gems as 5 distinct **shape+color** SVG sprites (diamond/teardrop/leaf/star/hex; see `02-scope.md`)
- `pixi/input.ts` — click to select, click adjacent to swap (visual only)
- `pixi/animations/swap.ts` — tween swap animation (~200ms)
- React root mounts both the HUD placeholder and the Pixi canvas

**Out of scope:** match detection, valid-swap checking, cascades, all combat.

**Acceptance:**
- ✓ Board renders with 5 distinct gem **shapes** (diamond/teardrop/leaf/star/hex), each in its color — legible to a color-blind reader
- ✓ Clicking two adjacent gems triggers a swap animation
- ✓ Non-adjacent clicks don't swap
- ✓ State and visual stay in sync after a swap

---

## Phase C — Match detection & cascade resolution

**Goal:** invalid swaps revert. Valid swaps trigger matches, gem clears, drops, refills, and chain cascades. No combat — board is the only system.

**Scope:**
- `core/board/detectMatches.ts` — horizontal+vertical scan, classify line/T/L
- `core/board/cascade.ts` — full cascade loop emitting `GameEvent[]`
- `core/board/gravity.ts` — drop survivors
- `core/rng/mulberry32.ts` + forked streams
- Refill from `rng.board`
- Initial board generation excludes pre-matches and verifies a valid swap exists
- `pixi/AnimationController.ts` — consumes event stream, animates step by step
- `pixi/animations/clear.ts` (flash + particles), `drop.ts` (gravity tween)
- Input lock during animation playback

**Out of scope:** scoring (pools), combat, relics, status effects.

**Acceptance:**
- ✓ Invalid swap reverts (no turn consumed, gems return to original spots)
- ✓ Valid swap clears matches, animates clears, drops survivors, refills top
- ✓ Cascades chain visibly until board is stable
- ✓ T and L matches detected correctly
- ✓ 5-line match clears a row or column
- ✓ Same seed → same board sequence (RNG determinism test passes)
- ✓ **Tests:** detectMatches unit tests (line/T/L cases + edge cases on corners); cascade-loop property test (10k random seeds → no orphan gems, board fills, deterministic with same seed); board-gen termination test (no infinite shuffle loop)

---

## Phase D — Gem pools, single combat turn

**Goal:** there's one enemy on screen. Matching gems fills pools (red/blue/green per-turn, yellow/purple persistent). At end of player turn, red auto-deals damage, blue becomes block, green heals. Enemy doesn't act yet.

**Scope:**
- `core/combat/turn.ts` — turn phases (`player-acting`, `resolving`, `player-phase-end`, `enemy-acting`, `enemy-end`)
- Pool tracking in `GameState.player`; R/B/G accumulate across the whole player phase (including extra-turn cycles)
- Auto-resolve at end-of-player-phase (red → damage, blue → block stat set, green → heal) — fires **once**, when the enemy is next to act
- React HUD: HP bar, block badge, mana, charge, pool indicators during phase
- Enemy frame (React): sprite placeholder + HP bar (no intent yet)
- Damage application logic, single target
- Block zeroed at start of next player phase, *before* Resolute fires (block is the "wall waiting for the enemy")
- Extra turn on 4+ match — extra turns are still inside the same player phase; no end-of-phase effects fire between them

**Out of scope:** enemy intents, enemy turn, spells, ultimate, relics, multi-enemy.

**Acceptance:**
- ✓ Match red → phase ends → enemy takes damage
- ✓ Match blue → phase ends → player has block; block stat is zero at start of the phase after that
- ✓ Match green → phase ends → player heals (capped at maxHP)
- ✓ Yellow/purple persist across phases (and credit immediately on match — usable next phase)
- ✓ 4+ match grants extra turn (player keeps acting); extra-turn chains are uncapped; end-of-phase effects fire once at phase end regardless of chain length
- ✓ Killing enemy ends combat (transitions to a placeholder "you win" state)
- ✓ **Tests:** phase-resolution unit tests (pool accumulation across extra turns, single end-of-phase resolve, block zero-at-next-phase-start, extra-turn chain, immediate vs. end-of-phase pool crediting)

---

## Phase E — Enemy intents, full combat loop

**Goal:** enemy telegraphs its next action, then acts on its turn. Player can die. One enemy archetype implemented (Brute) end-to-end as a vertical slice of combat.

**Scope:**
- `core/combat/intents.ts` — intent generation per enemy archetype
- Intent display above enemy sprite (icon + number) — React
- Enemy turn execution: resolve intent (attack/block/debuff), telegraph next
- Player damage taking, block consumption, HP → 0 → game over screen
- Brute archetype: attack pattern + numbers from scope doc
- React "Game Over" screen with restart button (returns to a fresh fight)

**Out of scope:** other enemy archetypes, multi-enemy, statuses, relics, map, shop.

**Acceptance:**
- ✓ Brute telegraph visible before player turn
- ✓ Brute acts on its turn, attacks for telegraphed amount
- ✓ Block reduces damage; remaining damage hits HP
- ✓ HP → 0 shows game over screen
- ✓ Restart returns to fresh fight with full HP

---

## Phase F — Spells, ultimate, status effects

**Goal:** Knight's full kit works. Bulwark and Reinforce are castable for mana. Riposte ultimate works on full charge. Burn/Vulnerable/Weak statuses apply, tick, and display.

**Scope:**
- `core/combat/statuses.ts` — status apply/tick/expire
- `content/statuses.ts` — Burn, Vulnerable, Weak definitions
- `content/spells.ts` — Knight spells + ultimate
- React spell buttons (active when mana sufficient, disabled otherwise)
- Ultimate button (active at full charge)
- **Pending-effects strip** next to phase indicator: shows icons for already-cast spells with deferred (end-of-phase) effects — visibility only, not a batching UI
- Status icons on player + enemy frames with tooltip
- Smolder enemy archetype — direct Burn-on-hit *and* its **tile-burn board verb** (flags 1-2 cells as burning, matching them applies Burn). First non-Corruptor instance of the `Cell.flags` system in action; proves the verb pipeline before H2 builds on it
- `core/board/flags.ts` — generic cell-flag read/write/tick helpers (Burn duration ticks, flag-clear on cascade-out, etc.) so each new verb in H2/J1 plugs in without re-implementing flag bookkeeping

**Out of scope:** relics, map, shop, remaining enemies, multi-enemy fights.

**Acceptance:**
- ✓ Bulwark consumes this phase's blue pool, converts to attack as `floor(blue / 2)`; no defense from blue that phase
- ✓ Reinforce **doubles** this phase's block on carry-over (then decays normally the phase after)
- ✓ Riposte counter-attacks the next enemy attack for the **full incoming pre-block damage**; if the next enemy turn has no attack, Riposte expires unused at the end of that turn
- ✓ Burn DoT visibly ticks at owner's turn start: deals `stacks` damage, then `stacks -= 1` (StS-style decay). Re-application accumulates `stacks` (both damage and turns left)
- ✓ Vulnerable/Weak multiply damage correctly; re-apply takes `max(current, incoming.stacks)` (refresh; multipliers stay binary on/off)
- ✓ Smolder applies Burn on hit
- ✓ **Damage preview on hover:** hovering an enemy with a telegraphed `⚔ N` shows `N − block = X to HP`, with Vulnerable/Weak factored in
- ✓ **Tests:** status apply/tick/expire unit tests; Bulwark end-of-phase resolution test (cumulative blue pool across extra turns is what's converted, block stat is zero that phase); damage-pipeline test (Vulnerable + Weak compose correctly; re-application rules respected)

---

## Phase G — Relic system, first 5 relics

**Goal:** relic event-hook system works end-to-end. Player acquires a relic between fights and its effect changes combat behavior.

**Scope:**
- `core/relics/engine.ts` — event bus + filter chain
- `core/relics/types.ts` — RelicDef shape
- All architectural hooks wired (onMatch, onCascade, onPhaseStart, onPhaseEnd, onDamageDealt, onDamageTaken, onBlockGained, onBlockBroken, onEnemyIntent, onSpellCast, onUltimateUsed, onEnemyKilled, onFatalDamage, onRelicGained, onRoundStarted) — even hooks unused by the first 5 relics, so J2's content fill drops in without engine churn
- `content/relics.ts` — first 5 relics: Iron Buckler, Sharp Edge, Thornmail, Cascade Crystal, Stoneheart
- React: relic tray on HUD (icon + tooltip)
- Hardcoded reward screen after fight: pick 1 of 3 random relics → relic added to state
- Verify modifier ordering: relics in acquisition order produce deterministic outputs

**Out of scope:** map, shop, remaining 15 relics, remaining enemies.

**Acceptance:**
- ✓ Iron Buckler: blue matches give +1 block (verify in fight)
- ✓ Sharp Edge: red matches give +1 attack
- ✓ Thornmail: enemy attacks reflect 1 damage
- ✓ Cascade Crystal: 2nd+ cascades visibly amplify pools
- ✓ Stoneheart: lethal damage leaves you at 1 HP (once per run); doesn't trigger again
- ✓ Modifier ordering test: two relics acquired in opposite orders produce the documented order-dependent outputs (e.g. `+1 red` then `×1.5` ≠ `×1.5` then `+1 red`), confirming acquisition-order evaluation
- ✓ **Relic-pair property test:** for every unordered pair of relics in the pool (~10 in Phase G, growing to ~190 by J2), run a deterministic test fight with each acquisition order and assert outputs match each relic's documented `orderHint` (commutative pairs: same output; non-commutative pairs: hints describe the divergence). Catches order bugs no manual playtest will find

---

## Phase H1 — Map, run flow, single-enemy fights

**Goal:** a procedural branching map renders. Fights happen at fight nodes (single-enemy only). After a fight + relic pick, you return to the map and pick the next node. You can win (reach + clear boss) or lose (die) a run, then restart.

**Scope:**
- `core/map/generate.ts` — 4-column procedural map with rule guarantees (1 elite, ≥1 shop reachable, ≥1 rest reachable, boss in col 5)
- `core/map/paths.ts` — node connectivity, valid-move rules (only adjacent column, only on existing edges)
- React MapScreen — SVG-based node graph, hover/click, current-node highlight, traversed-path dimmed
- Phase transitions: menu → map → fight → reward → map → ... → boss → victory or game-over
- Run-end states (game over from death, victory after boss)
- Boss encounter wired as single-enemy fight (using Brute stats for now — Corruptor gimmick in Phase J1)

**Out of scope:** multi-enemy combat, remaining enemy archetypes, AOE matches against enemies, shop/rest interactions, Corruptor curse, save/load.

**Acceptance:**
- ✓ Map renders with valid paths; rule guarantees verifiable (1 elite present, shop+rest reachable from start on every seed)
- ✓ Each fight advances current node; only valid edges are clickable
- ✓ **Hover a node → preview tooltip shows its type** (fight / elite / shop / rest / boss) before commit
- ✓ Reaching boss node → boss fight → victory screen on win
- ✓ Death any time → game over → restart returns to menu (fresh map, fresh seed)
- ✓ **Tests:** map-generation property test (1k seeds → all guarantees hold, no orphan nodes, all paths reach boss)

---

## Phase H2 — Multi-enemy combat, AOE, remaining archetypes

> **Split (2026-05-24):** Original single-phase H2 was sized at 4-5h but added up to ~12-15h on real inspection (4 verbs × design+code+telegraph+tests, plus a 591-line single-enemy `EnemyFrame` to rebuild). Split into three sub-phases so each ends at a runnable, demoable state. Locked decisions (carried into every sub-phase):
> - Multi-enemy layout: **horizontal row** above the board
> - AOE: relic `onMatch` runs once on the pool; modified deltas then fan out per-enemy through the normal damage pipeline (so per-enemy Vulnerable/Weak still compose independently)
> - Map weighting: **by tier** (column), not by archetype
> - Each board verb gets its **own `IntentKind`** (column-smash, petrify-row, color-hex, cluster-shove) — favors telegraph clarity over a generic discriminator

### Phase H2a — Multi-enemy plumbing, AOE, Skirmisher ✅ COMPLETE

**Status:** shipped 2026-05-24. Multi-enemy plumbing, target selection, AOE fan-out, Skirmisher, tier-weighted map generation all live. 170 tests passing.

**Goal:** fights can contain 1-3 enemies in a row; player selects target; AOE matches hit all living enemies. No new board verbs.

**Scope:**
- Multi-enemy fight state already exists (`FightState.enemies: Enemy[]`); UI catches up. `EnemyFrame` refactored into a list container + an `EnemyCard` for one enemy
- Target selection: click an enemy card to set `targetEnemyId`; selected card highlights; default = leftmost living at fight start; auto-reselect leftmost living on kill
- AOE damage: in the match walker, `shape !== 'line' || size === 5` triggers fan-out — relic `onMatch` runs once on the pool, modified red delta then applies per-enemy through `composeDamage` + `applyDamage` (Vulnerable/Weak per-enemy; Thornmail per-attacker stays correct because each per-enemy damage event carries the right `targetId`)
- **Skirmisher** archetype: low HP, attacks every turn, no verb. Stats per `02-scope` early-tier band
- Map generation pulls from `{ brute, smolder, skirmisher }` with tier weights (Skirmisher heavier in col 0-1; Brute/Smolder heavier in col 2-3). Fight-node enemy count: col 0-1 single, col 2-3 allows 2-3

**Out of scope:** new board verbs (H2b, H2c), shop, rest, Corruptor, save/load.

**Acceptance:**
- ✓ Multi-enemy fights spawn with 1-3 enemies laid out horizontally; clicking an enemy selects it
- ✓ 5-line / T / L match damages all living enemies; per-enemy Vulnerable/Weak compose independently; per-attacker Thornmail still reflects to the correct enemy
- ✓ Killing the targeted enemy auto-selects the next leftmost living one
- ✓ Skirmisher shows attack-every-turn behavior, lower HP than Brute
- ✓ Map generation respects tier weights (verifiable by sampling N seeds and asserting archetype distribution per column)
- ✓ **Tests:** AOE fan-out per-enemy damage independence; target auto-reselect on kill; map-generation tier-weight property test

---

### Phase H2b — Brute column-smash + Defender petrify-row ✅ COMPLETE

**Goal:** two verbs land on top of H2a. Brute's retrofit promised in the roadmap; Defender is the simplest new archetype because its verb only touches `detectMatches`.

**Scope:**
- New `CellFlags`: `pendingSmash?: number` (turns until smash fires), `petrified?: number` (turns remaining matchability lock). Both reuse the existing `tickFlagDuration` helper
- New `IntentKind`s: `column-smash`, `petrify-row`. Pre-flag at telegraph time (mirrors how `tile-burn` already telegraphs by flagging cells when the intent rolls — confirm current Smolder behaviour during implementation; if Smolder picks cells at fire time today, align both styles)
- Brute pattern becomes `attack, column-smash, attack, block, attack`. On resolve, clears the flagged column with no payout, refill from top via existing gravity. Matching the column before the smash phase clears the flag from those cells, denying the verb on those cells
- Defender: new archetype. Pattern `['block', 'petrify-row', 'attack', 'petrify-row']` (length-4 — aggressive petrify cadence). Stats: HP 22, attack 2-3, block 3-5. Persistent block accumulation already supported by H4b-era enemy block rules
- `detectMatches` reads the `petrified` flag and excludes matches that include a petrified cell as an anchor. Gems still cascade *through* — only the anchor check changes
- Map gen: add Defender to column weights (mid-column heavier); add Defender + Smolder as a role-mixed composition template (the wall + the burner)
- Pixi rendering passes for both flags (column-smash overlay + petrified-row overlay), wired into `BoardEffects`
- Intent telegraph UI for both kinds in `EnemyFrame.tsx`

**Out of scope:** Caster, Swarmer (H2c), shop, Corruptor, save/load, player-side board verb (deferred to H2b.5).

**Acceptance:**
- ✓ Brute telegraphs column-smash one phase before; on the smash turn, the column is wiped without paying pools; refill works
- ✓ Matching cells in the threatened column clears them from the smash set (counterable through play)
- ✓ Defender telegraphs petrify-row one phase before; matched rows are skipped as anchors for the duration; cascades still flow through
- ✓ Both flags tick down + clear automatically via `tickFlagDuration`
- ✓ Defender appears in map gen + at least one role-mixed composition (Defender + Smolder) lands
- ✓ **Tests:** column-smash resolution unit test (no payout, correct cells); petrify-row excludes anchors but allows cascade through; flag tick + expire behavior; counter-play (matching flagged cells before smash clears them from the verb)

---

### Phase H2b.5 — First player-side verb spell (micro-phase) ✅ COMPLETE

**Status:** shipped 2026-05-26. Shatter Color picked from the parked verb pool; spell live at 4 yellow (immediate, picker on a board cell to choose colour). Routes through the shared cascade walker so relic onMatch / onCascade hooks (Sharp Edge, Iron Buckler, Cascade Crystal) fire on the cleared cells and gravity-induced cascades chain naturally. 276 tests passing.

**Goal:** fill the design-doc requirement that "the slice should ship at least one player-side board verb" (§"Parallel play"). Drops one verb spell into the discoverable spell pool so player and enemy both gain board verbs in the same arc (H2b ships enemy verbs; H2b.5 ships the symmetric player half).

**Scope:**
- Pick one verb from the parked H4c candidate pool (Shatter Color / Detonator / Petrify-player / Transmute / Sweep / Banish — locked during phase open)
- Implement as a discoverable spell (mana cost, not free; goes into the reward pool, not class baseline)
- Wire into existing spell registry, picker modal where needed, pixi rendering for any spawned flag, tests
- Effect must run through normal match resolution where applicable (cascade multiplier, pool fills, relic hooks) — the verb is a board-state modifier, not a damage shortcut

**Out of scope:** the other 5 verb candidates (they ship as Phase I+ shop content); spell-acquisition shop UI (Phase I); spell-upgrade UI.

**Acceptance:**
- ✓ One verb spell live, mana-costed, in the reward pool (or temporarily granted at run start until shop ships)
- ✓ Verb composes correctly with cascade multiplier, blessed cells, and at least one existing relic
- ✓ Tests: cost+gate, effect resolution, composition with cascade/blessed

**Estimate:** 1-2h depending on verb pick (Sweep is simplest, Detonator is heaviest due to two-step trigger).

---

### Phase H2c — Caster color-hex + Swarmer cluster-shove ✅ COMPLETE

**Status:** shipped 2026-05-26. Both archetypes registered (Caster HP 12, hex duration 2 phases, Weak-on-hit attack rider; Swarmer HP 8, length-2 cluster-shove run). Color-hex applies Weak with stacks=match.cells.length on hexed-colour matches via cascadeProcessor (refresh semantics). Cluster-shove uses per-cell `pendingShove` flags so counter-play works independently — clearing one source cell denies its shove without affecting the other. Map weights extended (Caster + Swarmer at cols 1-3) and 4 new role-mixed compositions added (caster+rallier, swarmer×2/×3, defender+caster). 296 tests passing.

**Goal:** the two non-cell-flag verbs land — board-global state for Caster, board mutation for Swarmer.

**Scope:**
- New `FightState.hexedColors?: { color: GemColor; turnsLeft: number }[]` — board-global, not per-cell. Caster's hex intent picks a color, sets the entry; matching a gem of that color while it's active applies 1 stack of Weak per cell to the player. Hex ticks at start of caster's turn
- Caster pattern: alternates color-hex and direct Weak/Vulnerable debuff. Fragile — low HP, no block
- Swarmer cluster-shove: telegraphed one phase before (show source 2-cell run + destination), on resolve splice the run into the destination column/row. Existing gravity + match-detection picks up any resulting match naturally. Verb counterplay: clear the source cells before the shove fires
- Pixi rendering: hex pulse on all gems of the hexed color; shove path arrow during telegraph
- Map gen: Swarmer spawns in groups of 2-3 (only enabled now because multi-enemy is live since H2a). Add `Caster`, `Swarmer` to the tier-weighted pool

**Out of scope:** shop, Corruptor, save/load.

**Acceptance:**
- ✓ Caster telegraphs the hex color one phase before; matching that color during the hex applies Weak to the player; hex expires after its specced duration
- ✓ Swarmer telegraphs source + destination one phase before; on resolve, the run moves and any resulting match resolves normally
- ✓ Clearing the source cells before the shove cancels the verb on those cells (counterable through play)
- ✓ Swarmer spawns in groups (verifiable: at least one map node has 2+ Swarmers)
- ✓ **Tests:** hex applies Weak only on matching the hexed color, decays correctly; shove preserves cell count + flag state; resulting matches resolve through normal pipeline

---

## Phase H3 — Multi-color mana economy ✅ COMPLETE

**Status:** shipped 2026-05-24 (commit `f7250bd`). Per-color mana pools, wild substitution, 4-chip HUD, mana persistence across fights, all wired. 186 tests passing.

**Goal:** every match contributes to both an immediate effect (today's behaviour) *and* a persistent color mana pool that spells will cost from. Yellow becomes wild mana (universal 1:1 substitute). Purple stays as ultimate charge. Designed before H4 so spells are built into the new economy from day 1, not retrofitted. Full spec in `08-multi-color-mana-proposal.md`.

**Scope:**
- `Player.mana: number` → `Player.mana: { red, blue, green, yellow }` per-color storage
- `MANA_CAPS` constant: R/B/G = 8 each, Y = 5
- New `ManaCost` type in `src/types/index.ts` (per-color optional cost shape)
- Match-walker (`attemptSwap`): on each match, increment the matching color's mana pool, respecting cap
- Spell affordability gate (`castSpell`): check `ManaCost` against current mana pools, with **wild substitution** (yellow can pay for any color shortfall at 1:1)
- Spell consumption: pay exact color first, then yellow for shortfall
- Existing spells get color costs: **Bulwark = 3 blue**, **Reinforce = 4 blue**, **Riposte = 8 purple charge** (unchanged)
- HUD shows 4 mana chips (color-coded) replacing the single mana counter; wild (yellow) chip visually distinct
- Mana persists across fights within a run; wiped on restart

**Out of scope:** new spells beyond the existing 2 (that's H4), board verbs (H2b/H2c), mana-cap relics (J2).

**Acceptance:**
- ✓ Matching red/blue/green increments mana of that color (capped); existing immediate effect unchanged
- ✓ Matching yellow adds to wild mana (capped 5); no separate "generic" mana
- ✓ Bulwark / Reinforce cast iff player has 3 / 4 blue (or wild substitution to make up shortfall)
- ✓ Wild-mana substitution rule: spell can consume yellow as any color at 1:1
- ✓ Mana persists across fights; only wiped on `restart()`
- ✓ HUD displays all 4 color mana chips with cap indicators
- ✓ **Tests:** mana per-color accumulation; cap respected on match; wild substitution affordability; multi-color cost affordability (placeholder spell), persistence across fights

---

## Phase H4 — Spell roster expansion + ally-target intents

> **Split (2026-05-25):** Original single-phase H4 estimated at 8-10h. Split into H4a (spells, shipped) / H4b (ally intents, shipped) / H4c (hero power, **DROPPED 2026-05-26** — see H4c section). The hero-power decision was deferred to be re-litigated after the spell roster was in play; the re-litigation concluded that the gap was real (no player-side board verb) but not hero-power-shaped (the candidate verbs are too impactful to be free + cooldown). Parked verbs moved to the discoverable-spell pool.

**Goal (parent phase):** broaden response heterogeneity (player side) and threat heterogeneity (enemy side). Add new spells with multi-color costs. Add ally-target enemy intents (heal-ally, buff-ally, shield-ally) so enemy compositions can be role-mixed — but **also keep simple block/attack compositions in the pool** so multi-enemy variety doesn't require role-based units in every fight.

### Phase H4a — Spell roster expansion

> **Design pivot (2026-05-25):** Initial pass shipped 7 spells but design review (with the user) flagged 3 as too plain — Bash mirrored Bulwark, Steel Heart duplicated green-match healing, Cleanse's "−1 stack" was too marginal to be worth casting. Replaced with: **Ignite** (3R, apply 3 Burn to target), **Regenerate** (3G, regen 3 self → 6 HP over 3 turns), **Purify** (2G, remove a status entirely; +3 HP if it was Burn). Added 4 new spells for synergy depth: **Skewer** (2R, next match deals 2× damage), **Brittle** (3B, target 2 Vulnerable), **Surge** (3Y, next match counts as cascade level +2), **Cinder Lash** (2R+1G, apply 2 Burn + heal 2 — first multi-cost spell). Final pool: 10 spells + 1 ultimate.

**Goal:** the Knight's spell list grows from 2 → 10 (+1 ultimate). All spells respect the multi-color mana economy from H3.

**Spells (final list):**
- **Bulwark** (3B, pending) — blue pool → attack at floor/2, block zeroed.
- **Reinforce** (4B, pending) — block doubled + carries to next phase. Pairs with Bulwark.
- **Volley** (4R, pending, picker) — 3-hit AOE, player allocates targets at cast. Defers red damage during the phase; EOP splits the pool.
- **Focus** (2Y explicit, immediate, picker) — move up to 3 mana from source colour → target colour. Yellow can't fund itself.
- **Ignite** (3R, immediate, auto-target) — 3 Burn to current target.
- **Regenerate** (3G, immediate, self) — 3 Regen to self → heals 3/2/1 over 3 turns (6 HP total).
- **Purify** (2G, immediate, picker) — remove a player status entirely. If Burn, also heal 3.
- **Skewer** (2R, pending one-shot) — next match's red damage is doubled. Cleared by the next match (NOT EOP).
- **Brittle** (3B, immediate, auto-target) — 2 Vulnerable to current target.
- **Surge** (3Y, pending one-shot) — next match counts as cascade level +2 (triggers Cascade Crystal & future cascade relics on level-0 matches).
- **Cinder Lash** (2R+1G, immediate, auto-target) — 2 Burn to target + heal 2 self.
- **Riposte** (8 charge, ultimate) — unchanged.

**Engine plumbing:**
- `SpellDef.resolution: 'immediate' | 'pending'` discriminator.
- `castSpell(id)` branches on resolution. Immediate spells apply via per-spell resolvers in `core/combat/spellResolvers.ts`; pending spells push to `pendingSpells` (existing Bulwark/Reinforce pattern). Skewer/Surge are pending in shape but cleared by the next match (not by EOP); arm a per-phase flag on `Player` (`skewerArmed`, `surgeArmed`) that the cascade walker consumes.
- Picker-arg spells get dedicated store actions: `castPurify(statusKind)`, `castFocus(from, to)`, `castVolley(targets: string[])`.
- Volley's red-pool deferral: cascade walker skips `applyMatchRedDamage` while Volley is pending, accumulating into `phasePools.red`. EOP splits the pool into 3 chunks per the chosen distribution.
- New `StatusKind: 'regen'` — player-side mirror of Burn. Decays −1/turn, heals `stacks` HP at owner's turn start. Wired into `tickStatuses` + `beginPlayerPhase` (heal AFTER burn damage, so burn-then-regen pairs resolve damage first).
- Multi-cost mana costs already worked since H3's `mana.ts`; Cinder Lash is the first content user.

**Picker modals:** `PurifyPickerModal`, `FocusPickerModal`, `VolleyTargetModal`. Modal overlay style consistent with `RewardScreen`. ESC and backdrop-click close (cast aborts, mana not consumed).

**Out of scope:** ally-target intents (H4b), hero power (H4c dropped), spell acquisition / 6-slot cap (next sub-phase), new enemy compositions, spell upgrades, spell-acquisition shop UI (Phase I integration).

**Acceptance:**
- ✓ 10 spells + 1 ultimate visible in the spell tray, costs rendered as colored mana pips
- ✓ Existing Bulwark / Reinforce / Volley / Focus / Riposte work unchanged
- ✓ **Ignite:** cast → target gains 3 Burn; stacks with existing Burn
- ✓ **Regenerate:** cast → 3 Regen on player; ticks 3, 2, 1 HP over the next 3 turns, then expires
- ✓ **Purify:** cast → picker opens → pick status → it's removed entirely; if Burn, +3 HP
- ✓ **Skewer:** cast → pip in PendingStrip → next match's red damage is doubled, then the pip clears
- ✓ **Brittle:** cast → target gains 2 Vulnerable (existing refresh rule applies)
- ✓ **Surge:** cast → pip in PendingStrip → next match's cascade level is treated as +2 (visible via Cascade Crystal triggering on a level-0 match), then pip clears
- ✓ **Cinder Lash:** cast → target gains 2 Burn + player heals 2; needs both R and G mana (with wild substitution allowed)
- ✓ Target-required spells (Ignite/Brittle/Cinder Lash/Volley) disabled when no living enemy
- ✓ Purify disabled when player has no harmful statuses (Regen alone doesn't count)
- ✓ **Tests:** Ignite/Brittle/Cinder Lash apply correct statuses + heal; Regenerate apply + per-turn tick (3→2→1→expire) + cap at maxHp + burn-before-regen ordering; Purify removes entirely + Burn-kicker heals + caps + no-op on absent; Focus mana shift; Volley EOP split + remainder + dead-target skip + Vulnerable composition + kill reroute. (Skewer/Surge end-to-end coverage left to playtest — flag-then-consume cascade-walker logic is wired through store; unit-test harness would need a deterministic board.)

---

### Phase H4b — Ally-target intents + role-mixed compositions

**Goal:** broaden enemy intent vocabulary with three ally-target intent kinds, add the `strength` status they piggyback on, and seed map generation with role-mixed compositions. Simple-stacked compositions remain in the pool so multi-enemy variety isn't gated on role-based units.

**Scope:**
- **Ally-target intent kinds** (engine-level addition):
  - `heal-ally`: enemy targets an ally; adds HP to it next turn
  - `buff-ally`: enemy applies a Strength-like buff status to an ally (new status kind: `strength` — flat damage bonus while active)
  - `shield-ally`: enemy adds block to an ally
- **`strength` status** — new `StatusKind`. Flat damage bonus to outgoing attacks while stacks > 0; doesn't tick down per turn (sticks until removed). Composes through `composeDamage` after Vulnerable/Weak.
- **Intent telegraph:** ally-target intents show the source enemy → arrow → target ally on the intent badge. Same telegraph window as other intents (one phase before resolution).
- **Composition design:** map generation includes role-mixed compositions *and* simple stacking compositions. Two new role-mixed templates seeded: e.g. "Brute + Skirmisher-as-rallier (buff-ally)", "Defender + Smolder (shield-ally on Smolder so the burn-applier survives longer)". Simple-stacking compositions stay in the pool.
- One existing archetype gains an ally-target verb variant via intent pattern injection (no new archetype needed). Pick the lightest fit — likely Skirmisher (low HP, attacks fast) gaining a `buff-ally` variant.

**Out of scope:** new archetypes, Corruptor (J1), hero power (H4c dropped).

**Acceptance:**
- ✓ Three new intent kinds wired through `executeEnemyTurn`; resolution applies the correct effect to the named ally
- ✓ Ally-target intents telegraph clearly (source + target visible on the badge); damage-preview / hover stays correct on the targeted ally
- ✓ `strength` status applies, sticks until removed, composes additively into outgoing damage
- ✓ At least 2 new role-mixed multi-enemy compositions present in map generation
- ✓ Simple-stack multi-enemy compositions still appear (some nodes are still just N attackers)
- ✓ **Tests:** heal-ally HP add (capped at ally maxHp), buff-ally strength stack, shield-ally block add, strength composition in damage pipeline, composition map-gen distribution

---

### Phase H4c — Hero power (DROPPED 2026-05-26)

**Status:** **dropped** after H4a/H4b shipped. The deferral question was "is there a clear gap the expanded spell roster doesn't cover?" Answer landed in two parts:

1. **The gap is real but isn't a hero-power-shaped gap.** The kit has no player-side board verb (the demo feedback in `01-design.md` §"Parallel play" called this out as load-bearing). Filling it matters.
2. **The candidate verbs are too impactful to be free.** Shatter Color, Detonator/Mark, Petrify (player-side), Transmute, Sweep, Banish — each is strong enough that "free + cooldown" undersells the decision. Tying them to mana cost (and putting them in the discoverable spell pool) keeps the verb scarcity honest: a player earns them through play, pays for each cast, and the slot stays composable with relics and other spells.

**What replaces it:** the parked verbs become candidates for the **discoverable spell pool** (acquired via shop / post-fight reward / future class-spell-discovery system — Phase I and onward). They are NOT class-baseline. A Knight run might or might not roll any of them; that's fine, because the run-shape variability is part of the roguelike loop.

**Knight class identity is now locked as "kit + ultimate":** 10 baseline spells from H4a + Riposte ultimate + Resolute passive. No third "hero power" button slot. `01-design.md` updated to reflect.

**Parked verb candidates** (for discoverable-spell design in a later phase — order is rough strength gradient, not priority):
- **Shatter Color** — pick color → all gems of that color clear through normal match resolution (cascade multiplier applies, pools fill). Maximum payoff. Likely mana cost: high (e.g. 4-5 of any single color), so it's expensive and rare.
- **Detonator / Mark** — mark a gem; next time matched, all of that color clears + bonus pooled damage. Two-step, tactical. Composes with enemy board verbs (disruptable mark = real cost).
- **Petrify (player-side)** — lock N cells against enemy board verbs for one turn. Reactive; valuable against Brute/Defender/Smolder/Corruptor.
- **Transmute** — convert N gems of color A → color B. Tactical fix; less explosive than Shatter.
- **Sweep** — clear one row or column. Clean AoE; sets up cascades from above.
- **Banish** — permanently remove one gem. Smallest verb; useful for breaking clusters.

**Open design question (parked, not blocking):** the "per-fight (1 use per encounter)" framing came up during this decision and may be a better fit for **ultimates** than the current charge-based model (Riposte = 8 purple). Re-litigate when more class ults are designed (post-slice).

**Acceptance:** N/A. Phase removed from the dependency chain.

---

## Phase I — Shop, rest, gold economy

**Goal:** shop nodes let you spend gold on relics/heals/removes. Rest nodes offer heal-or-upgrade choice.

**Scope:**
- Gold tracking, drops per fight tier
- React ShopScreen: 3 relic offers (cost by rarity), 2 heals, 1 relic-remove
- React RestScreen: heal 30% HP OR upgrade a relic (relic upgrade = +1 to its numeric value where applicable; defer non-numeric upgrade design)
- Map node types fully implemented: fight, elite, shop, rest, boss
- Elite fights drop better relics (force uncommon/rare draw)

**Out of scope:** Corruptor curse gimmick, save/load, 10 remaining relics.

**Acceptance:**
- ✓ Gold drops visible after each fight
- ✓ Shop renders, items purchasable / disabled by gold availability
- ✓ Rest heal works, rest upgrade works
- ✓ Path through map respects rules (elite drops better relic)
- ✓ Run completes start-to-boss with shop+rest nodes encountered

---

## Phase J1 — Boss gimmick (Corruptor)

**Goal:** Corruptor boss has its full gimmick. Cursed-gem mechanic is fully wired through the cascade + damage pipeline.

**Scope:**
- `core/board/cursed.ts` — cursed-cell flag handling; resolution step sums cursed cells in each match and deals 1 self-damage per cursed cell to the player
- Corruptor enemy: every-2-turns intent that converts 2 random non-cursed cells to cursed
- Corruptor's full intent pattern (mix of attacks + conversions)
- Pixi rendering: cursed-gem visual overlay (purple desaturation + glow), persists across cascades while flag is set
- **Next-conversion preview:** on the player phase *before* a Corruptor conversion turn, the 2 cells that will be cursed if conversion fires now are pre-marked with a faint warning glyph (50% opacity of the cursed overlay). The cells are picked deterministically from `rng.enemy` and the current board, so the preview reflects truth. This converts a "feels-bad RNG" beat into a planning surface — the player can choose to clear those cells before the conversion lands.
- Self-damage flows through normal damage pipeline (relic hooks like Thornmail do NOT trigger on self-damage — explicit guard)

**Out of scope:** new relics, broader content fill, save/load, polish.

**Acceptance:**
- ✓ Corruptor converts gems on the right turn cadence; conversion targets non-cursed cells only
- ✓ Matching cursed gems deals 1 self-damage per cursed cell in the match (verified: 3-match with 1 cursed = 1 HP; 5-line with 3 cursed = 3 HP)
- ✓ Cursed overlay renders and clears correctly through cascades
- ✓ Next-conversion preview glyph appears on the 2 to-be-cursed cells one phase before the conversion turn; clearing those cells before conversion changes the targets (preview re-resolves against current board)
- ✓ Self-damage doesn't trigger Thornmail (or other "on damage taken from enemy" hooks); self-damage is not amplified by Vulnerable (source check via `DamageSource`)
- ✓ **Tests:** cursed-match self-damage unit test; Corruptor conversion-cadence test

---

## Phase J2 — Content fill, tuning

**Goal:** all 20 relics live. Status numbers and difficulty curve land on the design intent (~50-60% first-pass win rate). Slice is content-complete.

**Scope:**
- 10 more relics designed + implemented (mix of remaining hooks: onPhaseStart, onSpellCast, onBlockGained, onRelicGained, onRoundStarted, etc.)
- **Ordering hints in relic descriptions** for order-sensitive effects (e.g. "(applies after multipliers)") — no drag-to-reorder UI
- Extend relic-pair property test from Phase G to cover the full 20-relic pool (~190 pairs)
- Status effect numeric tuning (Burn DoT starting stacks; Vulnerable/Weak starting stacks)
- Difficulty pass: 3-5 real end-to-end runs; tune enemy HP/damage, gold drops, shop prices toward 50-60% win rate target
- Final balance review: no degenerate strategies (e.g. infinite block, one-shot ult)
- **Shareable seed URL** (`?seed=abc123` on load → starts a run with that seed; "copy seed" button on game-over). One afternoon, RNG infra already in place.

**Out of scope:** save/load, polish.

**Acceptance:**
- ✓ All 20 relics work; each tested in at least one playthrough context
- ✓ A clean run takes ~10-15 min
- ✓ A competent first-time run wins ~50-60% of attempts (3-5 run sample)
- ✓ No relic, status, or enemy interaction softlocks the game or trivializes it

---

## Phase K — Auto-save & persistence

**Goal:** closing the tab during a run lets you resume on next visit.

**Scope:**
- localStorage write at phase boundaries (after fight, after relic pick, after shop, after map node entered)
- `state.pendingReward` rolled at fight-end (deterministic from `rng.loot`) — survives reload so closing tab mid-reward restores the same offer set
- "Resume run?" prompt on app load if save exists
- Clear save on run end (death or victory)
- Save version field + mismatch handling (discard + start fresh)

**Out of scope:** mid-fight save, save export/share.

**Acceptance:**
- ✓ Close tab mid-run → reopen → resume prompt → click yes → state restored
- ✓ Decline resume → save cleared, fresh menu
- ✓ Run end clears save automatically
- ✓ Version mismatch handled gracefully

---

## Phase L — Polish pass

**Goal:** the slice feels good to play.

**Open with an external playtest.** Before any polish work, sit a non-developer in front of the game and watch them play a full run cold. Take notes silently; don't coach. The polish list below is the *starting* set — observed friction from the playtest takes priority and is allowed to displace items here.

**Scope:**
- **External playtest (gate, see above)** — derives the rest of the list
- **Spacebar fast-forward**: hold spacebar → animation queue per-step delay = 0. Drops queue draining to instant for the duration of the hold.
- **Battle log panel**: collapsible side panel that pretty-prints `GameEvent`s into human text ("Brute attacks for 7 — blocked 5, took 2; Thornmail reflects 1"). Builds directly on the event stream; doubles as debug + accessibility win.
- **First-encounter tooltips**: one-time pop-up tips on first 4-match, first 5-line, first cascade, first relic, first spell cast. `seenEventKinds: Set<string>` in save state; clears never. Replaces the missing tutorial.
- Animation timing tuning (cascade tempo, damage juice)
- Particle effects on big matches
- Number popups for damage / heal / block gained
- **Combo counter overlay**: "CASCADE x3!" floats up during chains (reads `cascadeLevel` from event stream — already tracked, just needs a renderer)
- Visual polish on HUD (clearer pool meters, better status icons)
- Edge-case bug bash (deadlocked boards, hook-order edge cases, weird relic interactions)

Audio (sfx, music) is a non-goal for the slice — see `02-scope.md`. Not in this phase, not on the time-permitting list.

**Acceptance:**
- ✓ External playtest completed; observed friction logged and addressed (or explicitly deferred with rationale)
- ✓ Spacebar fast-forward works; cascades drain instantly while held
- ✓ Battle log renders all event kinds with readable text; toggles open/closed
- ✓ First-encounter tooltips fire exactly once each per save
- ✓ A friend can play a run without getting confused
- ✓ Animations feel snappy, not laggy
- ✓ No obvious bugs in a 5-run playtest

---

## Dependency graph

```
A → B → C → D → E → F → G → H1 → H2a → H3 → H4a → H4b → H2b → H2b.5 → H2c → I → J1 → J2 → K → L
```

Note the H3/H4 insertion between H2a and H2b: the multi-color mana economy (H3) and the spell roster expansion (H4) need to land before the verb work because verb threats become much more interesting once the player has a richer response toolkit. Without H3/H4, H2b/H2c verbs would feel like one-note board hazards rather than threats the player engages with through spell choice. H1 must precede H2a (multi-enemy combat needs the run-flow scaffolding); H3 must precede H4 (spells are designed around the multi-color economy from day 1); J1 must precede J2 (boss must be fightable before the difficulty pass means anything).

---

## Time estimates (rough)

| Phase | Description | Estimate |
|-------|------|----------|
| A | Setup | 1-2h |
| B | Board + swap | 2-3h |
| C | Match + cascade | 4-6h |
| D | Pools + turn | 3-4h |
| E | Enemy AI | 3-4h |
| F | Spells + statuses | 4-5h |
| G | Relics (5) | 4-5h |
| H1 | Map + run flow (single-enemy) | 4-5h |
| H2a | Multi-enemy plumbing + AOE + Skirmisher | 4-5h ✅ |
| H3 | Multi-color mana economy | 6-9h ✅ |
| H4a | Spell roster expansion (5 new spells) | 5-7h ✅ |
| H4b | Ally-target intents + role-mixed compositions | 3-4h ✅ |
| H4c | Hero power | DROPPED — verbs moved to discoverable-spell pool |
| H2b | Brute column-smash + Defender petrify-row | 5-6h ✅ |
| H2b.5 | First player-side verb spell (micro-phase) | 1-2h ✅ |
| H2c | Caster color-hex + Swarmer cluster-shove | 5-7h ✅ |
| I | Shop + rest | 3-4h |
| J1 | Boss gimmick (Corruptor) | 3-4h |
| J2 | Content fill + tuning | 6-8h |
| K | Auto-save | 2-3h |
| L | Polish | open-ended |

**Total: ~64-90 hours** for a content-complete slice. Polish is uncapped.

---

## Notes for execution

- Each phase starts with reading the relevant section of `01-design.md`, `02-scope.md`, `03-architecture.md`.
- Each phase ends with a git commit tagged with the phase letter.
- If a phase reveals a flaw in design/scope/architecture, **update those docs first**, then implement. Don't let code and docs diverge.
- Tests for `core/` written alongside implementation, not after.
- After each phase: brief written reflection in commit message — what surprised you, what to adjust later.
