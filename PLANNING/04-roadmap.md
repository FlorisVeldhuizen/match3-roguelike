# Implementation roadmap

Status: **Phase F complete.** Working on Phase G next.

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
- ✓ Burn DoT visibly ticks down, deals damage at owner's turn start; re-apply stacks damage + refreshes duration
- ✓ Vulnerable/Weak multiply damage correctly; re-apply refreshes duration only (multipliers don't stack)
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

**Goal:** real combat variety. Fights can contain 2-3 enemies; player selects target. AOE matches hit all enemies. All 5 non-boss enemy archetypes (Brute + 4 new) are implemented and used in map node generation.

**Scope:**
- Remaining 4 enemy archetypes (Skirmisher, Caster, Defender, Swarmer) — intent patterns, stats, behaviors, **and each non-Skirmisher's board verb** (Caster: color hex; Defender: petrify row; Swarmer: cluster shove). Lock verb specifics at the start of this phase per the candidates in `02-scope.md`
- Brute board-verb retrofit (column smash), if not done earlier — Brute currently only has direct attacks
- Each new verb adds its flag to `Cell.flags` and its rendering pass; reuses the flag-tick helpers built in Phase F
- Multi-enemy fight state (array of enemies, per-enemy intent/HP)
- Target selection — click enemy to select; selected enemy receives single-target effects
- Default target = leftmost enemy at fight start
- AOE damage: 5-line and T/L matches hit all enemies (one source of damage per enemy, applied through normal damage pipeline)
- Map generation pulls from the full archetype pool (with weights — common archetypes early, harder ones later)
- (Smolder + tile-burn verb already implemented in Phase F.)

**Out of scope:** shop, rest, Corruptor curse, save/load.

**Acceptance:**
- ✓ Multi-enemy fights work; target selection persists until enemy dies or new selection
- ✓ 5-line / T / L match damages all living enemies; per-enemy damage applies Vulnerable/Weak/etc independently
- ✓ Each archetype shows its specced behavior (Defender gains block + petrifies rows, Swarmer comes in groups + shoves clusters, Caster applies debuffs + hexes colors, Skirmisher attacks every turn, Brute attacks + smashes columns)
- ✓ Every board verb is **telegraphed** one phase before it fires (which column, which color, which row) and **counterable** through play (clearing the threatened cells changes or denies the effect)
- ✓ Killing the targeted enemy auto-selects the next leftmost living one

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
- Status effect numeric tuning (Burn DoT amount + duration; Vulnerable/Weak duration)
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
A → B → C → D → E → F → G → H1 → H2 → I → J1 → J2 → K → L
```

Linear after the H and J splits. F and G could swap if you want relics before statuses, but design-wise statuses first is easier (Smolder is a useful test enemy for the relic system). H1 must precede H2 (multi-enemy combat needs the run-flow scaffolding); J1 must precede J2 (boss must be fightable before the difficulty pass means anything).

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
| H2 | Multi-enemy combat | 4-5h |
| I | Shop + rest | 3-4h |
| J1 | Boss gimmick (Corruptor) | 3-4h |
| J2 | Content fill + tuning | 6-8h |
| K | Auto-save | 2-3h |
| L | Polish | open-ended |

**Total: ~43-58 hours** for a content-complete slice. Polish is uncapped.

---

## Notes for execution

- Each phase starts with reading the relevant section of `01-design.md`, `02-scope.md`, `03-architecture.md`.
- Each phase ends with a git commit tagged with the phase letter.
- If a phase reveals a flaw in design/scope/architecture, **update those docs first**, then implement. Don't let code and docs diverge.
- Tests for `core/` written alongside implementation, not after.
- After each phase: brief written reflection in commit message — what surprised you, what to adjust later.
