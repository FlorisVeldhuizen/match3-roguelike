# Technical architecture

Status: **Phase 2 complete.** Reviewer-approved with the following adjustments: Zustand confirmed, auto-save at phase boundaries adopted, SVG gem assets adopted, React/Pixi split approved as-drafted, event surface accepted as-is for first pass.

The headline decisions:
- **Single immutable game state** managed via Zustand, mutated through pure reducer functions.
- **Two-track resolution**: synchronous logical events drive an async animation queue. Logic doesn't wait for animations.
- **Event bus + filter chain** for relic hooks: relics subscribe on acquisition, run in acquisition order for value-modifying events.
- **Seeded RNG with forked streams** for run reproducibility.
- **React** owns chrome (HUD, menus, map, shop, modals). **Pixi** owns the board only.
- **Vite + TypeScript strict**.

---

## 1. State model

### Single source of truth
One `GameState` object, immutable updates via reducer functions. No multiple stores. No state inside React components beyond UI ephemera (hover, open/closed modals).

Why: match-3 with cascades and relic hooks is a state machine. Distributing state across components or systems means cascade events touch many places. One store keeps it auditable — every state change is a logged action.

### Zustand, not Redux
- Less boilerplate, hooks-first, TS-friendly.
- Same conceptual model (reducer-style updates, selectors).
- Pixi can subscribe to the same store as React.

### State shape (sketch)
```ts
type GameState = {
  meta: {
    runSeed: string;
    runStartedAt: number;
    phase: 'menu' | 'map' | 'fight' | 'shop' | 'rest' | 'reward' | 'game-over' | 'victory';
  };
  rng: { board: RngState; enemy: RngState; loot: RngState; map: RngState };
  player: {
    hp: number; maxHp: number;
    block: number;
    mana: number;
    skillCharge: number;
    phasePools: { red: number; blue: number; green: number };  // per-phase pools, resolve at end of player phase (after all extra turns). Mana/skillCharge are top-level fields above — they credit immediately, not at end-of-phase.
    statuses: Status[];
    gold: number;
    relics: RelicInstance[];
    phasesSinceBlueMatched: number;                       // Resolute scaling: counts phases where no blue gem was matched (cap +5). Bulwark consuming the pool still resets this — match intent is what counts.
  };
  fight?: {
    enemies: Enemy[];               // each Enemy carries its own currentIntent + nextIntentIndex
    targetEnemyId?: string;
    turn: 'player' | 'enemy';
    turnNumber: number;             // increments per enemy-turn (player phase = "between two enemy turns")
    queuedSpells: QueuedSpell[];    // spells cast this phase, resolve at end-of-phase in cast order
    riposteArmed?: boolean;         // ultimate state — set on cast, cleared at end of next enemy turn
  };
  board?: {
    width: number; height: number;
    cells: Cell[][];           // [y][x]
    selectedSwap?: { from: Pos; to: Pos };
    isResolving: boolean;       // true while logical resolution in flight
  };
  map: {
    nodes: MapNode[];
    edges: MapEdge[];
    currentNodeId?: string;
    completedNodeIds: string[];
  };
  pendingReward?: {                                       // rolled at fight-end, survives reload
    rarity: 'common' | 'uncommon' | 'rare';
    offeredRelicIds: string[];
    gold: number;
  };
};

type Cell = {
  gemColor: GemColor;
  flags: CellFlags;  // enemy board verbs write here; cursed is the prototype
};

// Open set — each enemy archetype's board verb adds a flag.
// All flags are read by the resolution / matchability layer, never by the match-detection scan.
type CellFlags = {
  cursed?: boolean;        // Corruptor — self-damage on match
  petrified?: number;      // Defender — turns remaining; cell cannot anchor a match
  hexed?: GemColor;        // Caster — color override; matching cells of this color apply Weak
  burning?: number;        // Smolder — turns remaining; matching applies Burn
  pendingSmash?: number;   // Brute — turns remaining; column will be cleared without payout
};

type RelicInstance = {
  id: string;                           // looks up the RelicDef in the registry
  acquiredAt: number;                   // run-relative index; determines write-hook order
  runFlags?: Record<string, JsonValue>; // per-run state (e.g. Stoneheart.triggered)
  fightFlags?: Record<string, JsonValue>; // per-fight state (e.g. Mirror Plate.triggered); cleared at fight-start
};
```

`fightFlags` is cleared by the `onRoundStarted` step at the start of every encounter. `runFlags` persist until run end. Relic engine reads/writes these through helper accessors; relics never reach into other relics' flag bags.

### Updates
Pure reducer functions: `(state, action) => newState`. Use Immer (bundled with Zustand) so reducers read like mutations but produce immutable results. This is non-negotiable: cascade replay, undo on invalid swaps, save/load all depend on immutability.

### Pool crediting timing

> **Plan B revision — per-match damage and heal.** The original design had all three of R/B/G accumulate to end-of-phase and commit there. In practice the "loaded pool → big-bang at EOP" pattern produced an awkward in-between state on the HUD (a pip showing damage that was about to commit anyway), and the EOP single-commit moment didn't deliver the per-action satisfaction the per-match popups already promised. Red and green were pivoted to **per-match commit**: damage lands as the gem matches, heal restores HP as the gem matches. Blue (block) stayed pooled because it has to snap into place *before* the enemy attack — that timing is load-bearing for defense planning. Pool *stats* still increment as running meters so relic hooks can read "how much you dealt/healed this phase"; the architecture below reflects the shipped state.

Three-track accounting, applied during cascade resolution:

- **Yellow (mana) and purple (skill charge) credit immediately** to `player.mana` / `player.skillCharge` the moment a match resolves. They are usable starting the *next* player phase's spell-cast window. (Yellow matched this phase does not retroactively fund spells already cast this phase — those were paid pre-swap.)
- **Red (damage) and green (heal) commit per-match** during the cascade. Immediately after each `pool-gained` event for red/green, the store walker resolves the amount against state — red drains enemy block then HP, green restores player HP capped at maxHp — and emits a follow-up `damage-dealt` / `healed` event interleaved into the cascade stream. `player.phasePools.red` and `player.phasePools.green` still increment for the duration of the phase as **running meters** for relics that want to read "how much you dealt/healed this phase"; they reset to 0 in `resolveEndOfPhase` and again in `beginPlayerPhase`. They are *not* pending damage / heal — by the time EOP runs, the damage and heal already landed.
- **Blue accumulates in `player.phasePools.blue`** through the whole player phase (including all extra-turn cycles) and auto-resolves **once**, at end of player phase: blue → block stat set (overwrite, not add). Blue is not directly usable mid-phase except through spells that read the pool (e.g. Bulwark reads `player.phasePools.blue` at end-of-phase resolution).

`onMatch` modifier hooks see and can modify the pool deltas before they land — the MatchPayload includes both immediate-credit deltas (mana/charge) and pool deltas (R/B/G), and a hook can adjust either. Red/green deltas are then immediately consumed by the per-match walker; blue accumulates until EOP.

**Multiplier scope:** scoring multipliers (cascade tier, Cascade Crystal, etc.) apply to **all five pool deltas** uniformly. Yellow/purple are credited immediately but multiplied first; red/green are multiplied first then committed per-match; blue is multiplied at the moment it lands in the pool.

**Relic-surface implication.** Anything that wanted to read `phasePools.red` at EOP as "pending damage to scale" now needs to use the meter pattern instead: read the pool value either at EOP (as "total damage dealt this phase") or hook `onDamageDealt` (which now fires per-match, multiple times per swap). The architecture preserves the meter; it changes the semantic from *pending* to *cumulative*. New territory this opens: multi-hit synergies, per-hit DoT/stack application, streak/threshold rewards — explored in the relic design doc.

**Rounding (global):** all fractional results from multipliers and conversions **floor** to integer at the moment they land. Shared `applyMultiplier(amount, mult): number` helper in `core/combat/math.ts` (or similar) — every caller routes through it. Property test: same inputs always produce the same output regardless of order of multiplier composition (when commutative).

**Cascade multiplier table is content, not a constant.** Lives in `content/cascade.ts` as `cascadeMultipliers: [1, 1.5, 2, 3]` (index = cascade level, last value is used for level ≥ array.length). Lets a future rare relic (e.g. "Cascade Crystal MAX: [1, 2, 3, 5]") overwrite it without engine change. Free now, useful later.

---

## 2. Logical vs. visual: two-track resolution

This is the most important architectural pattern in the codebase. Get it wrong and animations will lie about state, or state will lie about animations.

### Logical track (sync, deterministic)
When a player commits a swap:
1. Reducer runs the **full cascade** synchronously and emits an ordered list of `GameEvent`s.
2. State updates atomically at each cascade step.
3. By the time the reducer returns, the game state is fully settled (all cascades resolved, all relic hooks fired, all enemies updated, turn possibly advanced).

```ts
type GameEvent =
  | { kind: 'swap'; from: Pos; to: Pos }
  | { kind: 'match-found'; cells: Pos[]; color: GemColor; size: number; shape: 'line' | 'T' | 'L' }
  | { kind: 'cascade-start'; level: number }
  | { kind: 'gems-cleared'; cells: Pos[] }
  | { kind: 'gems-fell'; movements: { from: Pos; to: Pos }[] }
  | { kind: 'gems-spawned'; spawns: { at: Pos; color: GemColor }[] }
  | { kind: 'pool-gained'; color: GemColor; amount: number }
  | { kind: 'relic-triggered'; relicId: string; effect: string }
  | { kind: 'damage-dealt'; targetId: string; amount: number; source: DamageSource }
  | { kind: 'damage-taken'; amount: number; blocked: number; source: DamageSource }
  | { kind: 'enemy-killed'; enemyId: string }
  | { kind: 'turn-ended' };

type DamageSource =
  | 'enemy-attack'      // standard enemy hit (triggers Thornmail, Mirror Plate, etc.)
  | 'status-dot'        // Burn or future DoTs
  | 'self-curse'        // Corruptor cursed-gem self-damage (does NOT trigger Thornmail / Mirror Plate)
  | 'spell-cost'        // future HP-cost spells (none in slice)
  | 'environment';      // future board effects
```

**Why a source field:** relic hooks need to discriminate. Thornmail reflects only `enemy-attack`; Mirror Plate's "first enemy hit" only fires for `enemy-attack`; Stoneheart's `onFatalDamage` triggers regardless of source (a lethal cursed match still saves you at 1 HP). Without this field, the Phase J1 self-damage guard becomes a tangle of caller-side checks.

### Event stream is a side-channel
The `GameEvent[]` produced by the reducer is **not** part of `GameState`. Events describe transitions; the saved state is post-transition. Persisting events would bloat saves with data that gets skip-drained on reload.

Implementation: the store exposes an `events$` emitter (or equivalent — verify on Pixi integration whether Zustand's `subscribeWithSelector` is enough). The reducer pushes onto it; `AnimationController` subscribes. On reload, no events replay — the board renders straight from settled state. Replay mode (post-slice) would record events to a separate dev/debug array, never to the canonical save.

### Visual track (async, animated)
A separate `AnimationQueue` consumes events one at a time and plays them in Pixi. Player input is disabled while the queue is non-empty; it re-enables on the same tick that the queue drains to empty (no extra delay frame — the lock is "queue length > 0", read each tick). The queue:
- Animates swap motion
- Flashes matched gems → particles → clears
- Drops surviving gems (gravity tweens)
- Spawns new gems from top
- Pulses HUD updates (damage numbers, pool fills)

**Critical**: the logical state is already final when animation starts. Animations describe the past, not the present. If the player closes the tab mid-animation, the saved state is still consistent.

### Why split?
- **Testability**: cascade logic tests don't touch Pixi.
- **Determinism**: same seed → same events, regardless of frame rate.
- **Skip animations**: a "fast mode" can drain the queue with zero delays. Speedruns or auto-replay are trivial.
- **Replay**: just re-emit a saved event stream to reproduce a run visually.

### Tradeoff acknowledged
Player loses input during animation playback. With sensible animation timing (~100-300ms per cascade step), this is fine and matches the genre. Not a tradeoff that hurts.

---

## 3. Match detection algorithm

### Board size
Lock at **8 wide × 8 tall** for the slice. Adjustable per-encounter later if needed.

### Algorithm: horizontal + vertical scan, then shape detection
```
for each row: scan left-to-right, find runs of same color length ≥ 3
for each col: scan top-to-bottom, find runs of same color length ≥ 3
merge overlapping runs into match groups
classify each group: line(3/4/5) | T | L (T and L = intersection of horizontal and vertical runs sharing a cell)
```

Complexity: O(w·h). On 8×8 that's 64 cell visits — fine to run on every cascade step. No need for incremental algorithms.

### Cascade loop
```
while (true):
  matches = detectMatches(board)
  if matches.empty: break
  emit match events, apply effects, clear cells
  apply gravity (drop survivors)
  spawn new gems (from RNG.board)
  cascade.level++
```

### Cursed cell flag
Cursed cells participate in matching like any other gem. After the match is detected, the resolution step reads the flag and applies self-damage. Match algorithm is unchanged.

**Gravity moves the whole `Cell` object** (gemColor + flags together), so a cursed gem visually falls into the row below and stays cursed. Newly spawned top-row gems are clean — the flag belongs to the gem, not the position. This matches the player's mental model ("this *gem* is cursed") and prevents the surprise of a refilled top cell suddenly turning purple.

### Match validity check (before allowing swap)
Trial swap, run `detectMatches`, if zero → revert, don't consume turn. Standard match-3 affordance.

### Initial board generation
Three-step pipeline, deterministic from `rng.board`:

1. **Fill + de-match:** generate a random board, then walk cells in row-major order; for any cell that completes a pre-existing match, replace it with a random valid (non-match-completing) alternative drawn from the colors that don't form a match in that position. This pass terminates in O(w·h) — each cell is touched once, and the alternative-color set is always non-empty for ≥3 colors.
2. **Valid-swap check:** scan adjacent pairs for any swap that would produce a match (`detectMatches` on a trial-swapped board). If at least one exists, we're done.
3. **Fallback if no valid swap:** force-place a guaranteed-swappable pair. Pick a random row, overwrite its first 4 cells with `[A, B, A, B]` where A,B are two distinct colors that do NOT match any of the cells immediately above or to the right of that row segment. Then **re-run step 1 only on cells outside the forced segment** (preserve the forced pair). One more valid-swap check (must pass by construction: swapping the second A with the third B forms an `[A, A, B, B]` → swap one more makes A,A,A,...). 

This always terminates in two passes. No shuffle loop. (Property test: 10k random seeds → all produce a playable board with no pre-matches and ≥1 valid swap.)

---

## 4. Turn / event system + relic hooks

### Event bus
Hooks listen by event kind. Two flavors:

**Listener hooks** (read-only, no return value):
```ts
type Listener = (event: GameEvent, state: GameState, ctx: HookContext) => void;
// e.g. onEnemyKilled: heal 5 HP — emits a state-update action
```

**Modifier hooks** (filter chain on a payload):
```ts
type Modifier<T> = (payload: T, state: GameState, ctx: HookContext) => T;
// e.g. onMatch: payload.poolGain.red += 1
```

For modifiers, relics in `state.player.relics` are evaluated **in acquisition order**. This is deterministic and easy to reason about. Order-sensitive relics get clearly documented effects ("apply early" / "apply late").

### Hook surface (from design doc)
```
onMatch, onCascade, onPhaseStart, onPhaseEnd,
onDamageDealt, onDamageTaken, onBlockGained, onBlockBroken,
onEnemyIntent, onSpellCast, onUltimateUsed,
onEnemyKilled, onFatalDamage,
onRelicGained, onRoundStarted
```

A **phase** spans the player regaining control through to the enemy acting (extra-turn cycles are inside one phase). `onPhaseStart` / `onPhaseEnd` fire **once per phase**. If a relic later needs per-swap granularity, add `onSwapResolved` — don't overload the phase hooks.

Final list locks at execution time. Architecture allows adding hooks without breaking existing relics.

### Relic definition shape
```ts
type RelicDef = {
  id: string;
  name: string;
  rarity: 'common' | 'uncommon' | 'rare';
  description: string;       // shown in UI
  hooks: {
    onMatch?: Modifier<MatchPayload>;
    onEnemyKilled?: Listener;
    onPhaseEnd?: Listener;
    // ... etc
  };
};
```

Each relic is a data record + a small set of hook functions. Defined once in `src/content/relics/`, instantiated when acquired.

### Registry pattern (boundaries-friendly)
`core/relics/engine.ts` cannot import from `content/` (boundaries rule). Instead:

- `core/relics/registry.ts` exposes `registerRelic(def: RelicDef)` and `getRelic(id: string)`.
- `content/relics.ts` calls `registerRelic(...)` for each definition at bootstrap (imported once from `main.tsx`).
- Engine looks up hook functions by `RelicInstance.id` via the registry.

This keeps the engine pure and lets content remain data-shaped, without relaxing the import boundary.

### Acquisition-order visibility
Write-hook order is acquisition order. Rather than expose a drag-to-reorder UI, **relic descriptions include ordering hints** for order-sensitive effects (e.g. "(applies after multipliers)", "(triggers before damage modifiers)"). This makes ordering legible without adding an interaction surface. Drag-to-reorder is parked as post-slice.

### Relic pick offer generation
When rolling a 3-relic pick screen (or shop offer) at a given rarity:

1. Filter the full pool to unowned relics of the requested rarity.
2. If `unowned.length >= 3`: draw 3 without replacement from `rng.loot`.
3. If `unowned.length < 3`: fill the shortfall by drawing from the **next-rarer** tier's unowned pool (rare > uncommon > common). Promotion never demotes — e.g. a common-tier roll can pull from uncommon/rare to fill, but a rare-tier roll never falls back to common.
4. If all tiers are exhausted (player owns every relic): show a "**Skip for +10 gold**" option instead of a pick screen.

This keeps long runs from softlocking on the reward step and lets late-game commons trade up to rarer fills as a soft pity.

### State changes from hooks
Hooks dispatch state actions like any other code path. The event-emission cascade and the action-dispatch flow are separate: events describe *what happened*, actions cause *what changes next*. A hook can dispatch actions in response to an event.

To prevent infinite loops (hook triggers event, event triggers hook): the event queue is processed one event at a time, and new events queued by hooks process *after* the current cascade resolves. Stack depth is bounded.

---

## 5. Seeded RNG

### Single root seed
Run starts with a single string seed (random or user-provided for daily-seed-like features later). Shown in the UI so runs can be shared.

### Forked streams
Forked into independent named streams:
- `rng.board` — gem spawning
- `rng.enemy` — enemy intent numeric rolls (damage/block values within archetype ranges; intent *kind* is scripted per archetype, not RNG-driven — see design doc)
- `rng.loot` — relic drops, shop offerings
- `rng.map` — node generation

Why fork: changing board fill RNG shouldn't perturb loot drops. Each stream is its own seed derived from the root + a stream name via `cyrb53(rootSeed + ':' + streamName)` (cyrb53 is ~10 lines, deterministic, well-distributed for short string inputs — no external dependency). The 53-bit output is masked to 32 bits for the mulberry32 stream state.

### Implementation
Small custom PRNG (mulberry32 or similar). 30 lines of code. No external dependency.

```ts
type RngState = { seed: number };
// All functions are pure: they return the rolled value AND the advanced RngState.
// Callers must thread the new state back into GameState; the old RngState is dead.
function next(rng: RngState): [number, RngState];                  // value in [0, 1)
function nextInt(rng: RngState, max: number): [number, RngState];
function pick<T>(rng: RngState, arr: T[]): [T, RngState];
function shuffle<T>(rng: RngState, arr: T[]): [T[], RngState];
```

Why tuple-return: mulberry32 advances a 32-bit integer per call. If `next` mutated `RngState` in place, `JSON.stringify(state)` taken before the call would not match the seed actually consumed — replay and save would diverge silently. Returning the next state forces every caller to update `GameState.rng`, keeping the immutability invariant intact and property tests deterministic.

All RNG state lives in `GameState.rng` and updates via reducer.

---

## 6. React ↔ Pixi boundary

### React owns
- Top-level routes/screens (menu, map view, fight view, shop, game over)
- HUD: HP/block/mana/charge bars, status icons, gold, relic tray
- Enemy frame: sprite container + intent badge + HP bar (sprite is Pixi-rendered if animated; otherwise just SVG/img)
- Map view (SVG-based — nodes are SVG circles + edges are SVG lines)
- Modals: relic pick screen, shop, rest options, settings
- Spell/ultimate buttons + animations

### Pixi owns
- The match-3 board only:
  - 8×8 grid of gem sprites
  - Selection / hover indicators
  - Swap animation
  - Match flash + particle effects
  - Gem-drop physics (tweens)
  - Special-clear animations (row/col line, area pulse)

### Communication
- **Both** subscribe to the Zustand store as the source of truth.
- React re-renders on relevant slice changes (selectors prevent over-rendering).
- Pixi has an `AnimationController` that subscribes to the **events emitter** (the side-channel from §2, *not* part of `GameState`). New events push onto the controller's queue and trigger draining. The Pixi scene is **not** a function of state alone — it's a function of (state + event stream history played out over time).
- User input on the board: Pixi captures clicks/drags, dispatches Zustand actions (`attemptSwap`).
- User input on HUD/spells/etc.: React handles, dispatches actions.

### Why this split
- React is good at: declarative UI with lots of state-driven layout (HUDs, menus, lists). Bad at: 60fps tween animations with particle systems.
- Pixi is good at: high-performance Canvas rendering, sprites, animations. Bad at: form layouts, modal stacks, accessible buttons.
- Use each for what it's good at. The board is the single Canvas surface; everything else is DOM.

---

## 7. Save format

### Decision: auto-save at phase boundaries (localStorage)

- Save fires on **phase transitions only**: after a fight ends, after a relic pick, after leaving shop/rest, after a map node is entered. **Never** mid-cascade or mid-animation.
- One key: `match3-roguelike-current-run`. Stores serialized `GameState`.
- On app load: if a saved run exists, show "Resume run?" prompt. Yes → rehydrate state, jump to current phase. No → clear save, start menu.
- On run end (death or victory): save cleared.

### Why this works
`GameState` is JSON-serializable by design: no Maps with object keys, no Dates, no class instances — only plain data. Functions live in `RelicDef` lookups by ID, not in state. The event stream is a side-channel (see §2), so it never enters the save. So save is `JSON.stringify(state)`, load is `JSON.parse`.

### Reward-state survival
Relic-pick offers are rolled at fight-end and stored in `state.pendingReward` (offered IDs + gold). Closing the tab during reward selection then reloading restores the same offers — no seed divergence from "did you see the reward screen before closing." The pending block clears when the player picks (or skips).

### Version field
Save includes a `saveVersion: 1` field. On load, if version mismatch (older save vs newer code), discard save and start fresh — no migration logic needed for slice. Add a one-line guard, log it, move on.

---

## 8. Folder structure

```
src/
  core/                  # pure game logic, no React, no Pixi
    state/
      store.ts           # Zustand store creation
      reducers/          # reducer functions per concern
      selectors.ts
    rng/
      mulberry32.ts
      streams.ts         # fork helpers
    board/
      detectMatches.ts
      cascade.ts         # cascade loop
      gravity.ts
      generation.ts
    combat/
      turn.ts
      damage.ts          # damage calc with modifiers
      statuses.ts
    relics/
      engine.ts          # hook execution
      registry.ts        # registerRelic / getRelic — content registers here at bootstrap
      types.ts
    map/
      generate.ts
      paths.ts
  content/               # data only
    enemies.ts
    relics.ts
    statuses.ts
    spells.ts
    cascade.ts           # cascade multiplier table (data, swappable by relics)
  ui/                    # React
    App.tsx
    screens/
      MenuScreen.tsx
      MapScreen.tsx
      FightScreen.tsx
      ShopScreen.tsx
      RewardScreen.tsx
      GameOverScreen.tsx
    components/
      HUD.tsx
      EnemyFrame.tsx
      RelicTray.tsx
      SpellButtons.tsx
      StatusIcons.tsx
      RelicPickModal.tsx
    hooks/
      useGameState.ts
  pixi/                  # Pixi rendering of the board
    BoardScene.ts
    GemSprite.ts
    AnimationController.ts
    animations/
      swap.ts
      cascade.ts
      clear.ts
      drop.ts
    input.ts             # click/drag → actions
  types/
    index.ts             # shared types
  main.tsx               # bootstraps React + Pixi
  index.html
```

Three import rules (enforced by `eslint-plugin-boundaries`):
1. `core/` may not import from `ui/` or `pixi/`.
2. `content/` may not import from anywhere except `types/` and `core/relics/types`.
3. `ui/` and `pixi/` may import from `core/`, `content/`, `types/`, but not each other.

Use `eslint-plugin-boundaries` (not `no-restricted-imports`) — the boundaries plugin defines element types (`core`, `content`, `ui`, `pixi`, `types`) and an allow-matrix between them, which both enforces the rules and acts as living documentation. `no-restricted-imports` would only catch direct path imports, missing transitive violations and harder to read.

```js
// eslint.config.js excerpt (eslint-plugin-boundaries v6 syntax)
'boundaries/dependencies': ['error', {
  default: 'disallow',
  rules: [
    { from: { type: 'core' },    allow: [{ to: { type: 'core' } }, { to: { type: 'types' } }] },
    { from: { type: 'content' }, allow: [{ to: { type: 'types' } }, { to: { type: 'core' } }] },
    { from: { type: 'ui' },      allow: [{ to: { type: 'core' } }, { to: { type: 'content' } }, { to: { type: 'types' } }] },
    { from: { type: 'pixi' },    allow: [{ to: { type: 'core' } }, { to: { type: 'content' } }, { to: { type: 'types' } }] },
  ],
}]
```

Resolution requires `eslint-import-resolver-typescript` configured under `import/resolver` so the plugin can map relative imports to element types.

This is the architecture's hardest discipline. Following it means game logic stays testable and rendering stays swappable.

---

## 9. Tooling

- **Vite** + **React** + **TypeScript** (strict)
- **PixiJS v8** (latest, Canvas/WebGPU auto-detection)
- **Zustand** (state)
- **Immer** (immutability ergonomics — bundled w/ Zustand or as middleware)
- **Vitest** (unit tests; same Vite config, no Jest setup hell)
- **ESLint** + **Prettier**
- No CSS framework needed at slice scope — handcrafted CSS modules for ~10 components
- SVG for gems (vector, custom artwork) loaded as Pixi textures via Pixi's SVG loader

### Test strategy
- `core/` has high unit test coverage (match detection, cascade resolution, RNG determinism, relic hook order). These tests are fast and worth the investment.
- `ui/` and `pixi/` mostly untested — verified by manual playtest. Smoke-test render only.
- Property-test cascade resolution: random boards, run cascades, assert invariants (no orphan gems, board fills, deterministic with same seed).

---

## 10. Known unknowns

These get resolved during execution, not now:
- Exact tween timings for cascades (feel-based, tune in browser)
- Pixi v8 specific particle API (verify when we start)
- Mobile-touch input deferred (non-goal)
- Music/sfx pipeline deferred (non-goal)
- Whether Zustand's `subscribeWithSelector` is enough for Pixi or we need a custom event subscription — verify on first integration

---

## Resolved on review
1. **Zustand** — approved.
2. **Save** — auto-save at phase boundaries adopted (was originally non-goal, promoted to a feature because state design makes it nearly free).
3. **Gem rendering** — SVG assets adopted. Easy to swap to fancier artwork later without touching code.
4. **React/Pixi split** — approved as drafted.
5. **Event surface** — accepted for first pass. May extend during execution if relics turn out to need hooks we missed.
