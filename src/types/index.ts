export type GemColor = 'red' | 'blue' | 'green' | 'yellow' | 'purple'

export const GEM_COLORS: readonly GemColor[] = [
  'red',
  'blue',
  'green',
  'yellow',
  'purple',
] as const

// Phase F adds the first board-verb flag: `burning`. The flag carries the
// remaining duration (in player phases). More flags land in H2/J1 — keep
// the bag open-ended so each verb plugs in without re-shaping Cell.
//
// `blessed` is the match-5 reward flag (player-side, opposite of burning).
// 1-bit: present or absent, no duration. Set on the cells cleared by a
// line-5 match and inherited by whatever gem ends up there after gravity
// + refill. Matching a blessed gem doubles all pool deltas for that match
// (see PLANNING/01-design.md §Blessed cells).
export type CellFlags = {
  burning?: number
  blessed?: true
  // H2b: Brute's column-smash telegraphs by pre-flagging every cell in
  // the threatened column with the source enemy's id. Trigger-based,
  // NOT duration-based — the flag has no countdown; it's consumed when
  // the source enemy fires its column-smash intent (cells cleared) OR
  // when the player matches the gem (flag goes with the gem via gravity).
  // Storing the enemy id lets us sweep orphan flags when the source
  // enemy dies before firing. Gem-bound (travels with the gem under
  // gravity), like burning/blessed.
  pendingSmash?: string
}

// H2b: Defender's petrify-row is *position-bound*, not gem-bound — the
// lockout is on a row's positions, not on the gems passing through it.
// Stored in BoardState as a row-index → turns-remaining map. Cleared
// when ticking to 0. detectMatches reads this to exclude rows as match
// anchors. Gems still cascade *through* — only matching is blocked.
export type PetrifiedRows = Record<number, number>

export type Cell = {
  gemColor: GemColor
  flags?: CellFlags
}

export type Pos = { x: number; y: number }

export const BOARD_WIDTH = 8
export const BOARD_HEIGHT = 8

export type MatchShape = 'line' | 'T' | 'L'

export type Match = {
  cells: Pos[]
  color: GemColor
  size: number
  shape: MatchShape
}

export type DamageSource =
  | 'enemy-attack'
  | 'player-attack'
  | 'burn'
  | 'riposte'
  | 'thornmail'

// H4a: 'regen' is the player-side counterpart to Burn — stacks decay
// −1 per tick, and on the owner's turn-start tick `stacks` HP is healed
// (capped at maxHp). Re-applying accumulates stacks like Burn.
// H4b: 'strength' is a flat outgoing-damage bonus that does NOT decay
// per tick; sticks until removed by something else.
export type StatusKind = 'burn' | 'vulnerable' | 'weak' | 'regen' | 'strength'

// One number per status (Slay-the-Spire pattern). `stacks` is both
// "magnitude" and "turns left" — every tick decrements stacks by 1, and
// for Burn the tick also deals damage equal to current stacks. So a
// Burn 3 deals 3 → 2 → 1 → expires (6 damage over 3 turns). Vulnerable
// and Weak don't tick damage; their multiplier is active as long as
// stacks > 0.
export type StatusInstance = {
  kind: StatusKind
  stacks: number
}

export type SpellId =
  | 'bulwark'
  | 'reinforce'
  | 'volley'
  | 'focus'
  | 'ignite'
  | 'regenerate'
  | 'purify'
  | 'skewer'
  | 'brittle'
  | 'surge'
  | 'cinder-lash'
export type UltimateId = 'riposte'
export type PendingSpellId = SpellId | UltimateId

// H4a: spell resolution timing. 'pending' = effect resolves at EOP (or
// on a later trigger like an enemy attack); the spell sits in
// `pendingSpells` after cast. 'immediate' = effect applies inline at
// cast time; spell does NOT enter `pendingSpells`. Bulwark/Reinforce/
// Riposte/Bash/Volley are pending; Steel Heart/Cleanse/Focus are
// immediate.
export type SpellResolution = 'pending' | 'immediate'

export type GameEvent =
  | { kind: 'swap'; from: Pos; to: Pos }
  | { kind: 'swap-reverted'; from: Pos; to: Pos }
  | {
      kind: 'match-found'
      cells: Pos[]
      color: GemColor
      size: number
      shape: MatchShape
      // Set by the store on the first 4+ match of a swap when the bonus turn
      // will actually be granted. Drives the in-cascade "+1 TURN" feedback.
      grantsExtraTurn?: boolean
      // True when any cell in `cells` has the `blessed` flag at the moment of
      // the match. Triggers the 2× pool-delta multiplier in the store and the
      // gold "BLESSED!" callout in FX. Set in cascade.ts before clear, since
      // the flag is wiped by the same step.
      blessed?: boolean
    }
  | { kind: 'cascade-start'; level: number }
  // Emitted once after a swap's cascade loop fully resolves. `levels` is the
  // total number of chain links (1 = just the initial match, 2+ = at least
  // one chain). Used by the SFX layer to play a celebration on good chains.
  | { kind: 'cascade-complete'; levels: number }
  | { kind: 'gems-cleared'; cells: Pos[] }
  | { kind: 'gems-fell'; movements: { from: Pos; to: Pos }[] }
  | { kind: 'gems-spawned'; spawns: { at: Pos; color: GemColor }[] }
  | { kind: 'board-shuffled'; cells: { at: Pos; color: GemColor }[] }
  // Fired by the AnimationController when the board sweeps gems off after
  // a fight ends (victory or game-over). Cell-anchored overlays (e.g.
  // BurningOverlay's flames) listen and clear their decorations so they
  // don't linger after the gems they were sitting on have dropped away.
  | { kind: 'board-swept' }
  // Fires once per column during the level-start intro animation, scheduled
  // to land with that column's visual touchdown. Purely cosmetic — audio
  // subscribes to play a drop thunk; gameplay subscribers should ignore it.
  | { kind: 'board-intro-landed'; column: number }
  | { kind: 'pool-gained'; color: GemColor; amount: number }
  | {
      kind: 'damage-dealt'
      targetId: string
      // amount = HP damage to the target. blocked = portion absorbed by
      // target.block. Total incoming = amount + blocked. Mirrors damage-taken.
      amount: number
      blocked: number
      source: DamageSource
    }
  | {
      kind: 'damage-taken'
      amount: number
      blocked: number
      source: DamageSource
      // Which enemy fired the attack. Set for 'enemy-attack' source (always)
      // and undefined for player-side sources like 'burn' at phase start.
      // Lets the FX layer pulse the actual attacker in multi-enemy fights
      // instead of falling back to targetEnemyId.
      attackerId?: string
      // Optional hint that this attack also applies a status to the player.
      // Set by enemyTurn when intent.onHit fires AND the hit lands hp damage
      // (the rider's actual proc gate). Lets the FX/audio layer fold the
      // status apply into the impact moment instead of treating it as a
      // 350ms-later sequel — the fire IS the attack, not a follow-up.
      onHitRider?: StatusKind
    }
  | {
      kind: 'status-applied'
      target: 'player' | string
      status: StatusInstance
      // Visual hint for the FX layer — where particles should fly *from*.
      // Engine logic doesn't read this. `enemy` for Smolder-on-hit style
      // (caster is the acting enemy), `board-cells` for a tile-burn match
      // that bounces Burn back at the player, `player` for player-applied
      // statuses (none yet, but reserved for relics).
      source?:
        | { kind: 'enemy'; enemyId: string }
        | { kind: 'board-cells'; cells: Pos[] }
        | { kind: 'player' }
    }
  | {
      kind: 'status-ticked'
      target: 'player' | string
      statusKind: StatusKind
      remaining: number
    }
  | { kind: 'status-expired'; target: 'player' | string; statusKind: StatusKind }
  | { kind: 'spell-cast'; spellId: PendingSpellId }
  | { kind: 'pending-effect-resolved'; spellId: PendingSpellId }
  | { kind: 'riposte-counter'; targetId: string; amount: number }
  | {
      kind: 'tile-burn-placed'
      cells: Pos[]
      enemyId: string
      // How many player phases the tiles will stay burning. The
      // BurningOverlay reads this directly instead of probing the
      // store, which avoids picking up a wrong number when an
      // earlier flame is already at a lower remaining count.
      duration: number
    }
  // H2b: Brute pre-flags a column at telegraph time. Cells carries
  // every cell in that column. Overlay reads this to render the threat.
  // No `duration` — the smash is a trigger-based one-shot, not a
  // sustained effect; the flag is cleared either by the smash firing
  // or by the orphan sweep when the source enemy dies.
  | { kind: 'column-smash-placed'; enemyId: string; column: number; cells: Pos[] }
  // H2b: Smash fires — the flagged cells are cleared with no payout.
  // Carries the cells that actually got cleared (i.e. the flag survived
  // counter-matching). May be empty if the player cleared the column.
  | { kind: 'column-smash-resolved'; enemyId: string; column: number; cells: Pos[] }
  // H2b: Defender telegraphs the row to be petrified next turn. The
  // overlay shows a "warning" treatment from this event; the actual
  // lockout doesn't take effect until petrify-fired (one phase later).
  | { kind: 'petrify-placed'; enemyId: string; row: number; cells: Pos[]; duration: number }
  // H2b: Defender's petrify intent resolves and the row is now locked
  // for `duration` player phases.
  | { kind: 'petrify-fired'; enemyId: string; row: number; duration: number }
  // H2b: tickPetrifiedRows decremented a row's remaining-turns counter.
  // `remaining: 0` means the row just expired (was removed from the
  // active lockout map). FX layer rides this for the weakening →
  // released animation hand-off.
  | { kind: 'petrify-row-ticked'; row: number; remaining: number }
  // Emitted when a match clears one or more cells whose `burning` flag was
  // active. The consumer (store) computes Burn magnitude from cells.length
  // plus a content-side bonus (see BURN_FROM_TILE_BONUS in content/statuses).
  | { kind: 'tile-burn-triggered'; cells: Pos[] }
  // Emitted when a line-5 match flags the cleared cells as Blessed. The
  // positions are the (x,y) coords that will inherit the flag once gravity
  // + refill places a new gem there. FX layer uses this to seed the gold
  // rim + sparkle overlay. See PLANNING/01-design.md §Blessed cells.
  | { kind: 'tile-blessed-placed'; cells: Pos[]; color: GemColor }
  // Emitted when a match clears one or more cells whose `blessed` flag was
  // active. Carries the count for audio/FX intensity, mirroring tile-burn-
  // triggered's role. The 2× multiplier itself is applied in the store via
  // the `blessed` flag on the preceding match-found event.
  | { kind: 'blessed-match-triggered'; cells: Pos[]; count: number }
  // `expired` is the subset of `positions` whose remaining duration just
  // reached 0 (flag cleared this tick). Lets UI/SFX react to the "burn
  // fizzled out unmatched" beat without re-deriving it from the board.
  | {
      kind: 'cell-flag-ticked'
      positions: Pos[]
      expired: Pos[]
      flag: keyof CellFlags
    }
  | { kind: 'block-gained'; amount: number }
  | { kind: 'enemy-block-gained'; enemyId: string; amount: number }
  | { kind: 'block-absorbed'; targetId: 'player' | string }
  | { kind: 'block-broken'; targetId: 'player' | string }
  | { kind: 'healed'; amount: number }
  | { kind: 'enemy-killed'; enemyId: string }
  // Ally-support events: emitted when an enemy heals or shields a sibling.
  | { kind: 'ally-healed'; sourceId: string; targetId: string; amount: number }
  | { kind: 'ally-shielded'; sourceId: string; targetId: string; amount: number }
  // Emitted at the start of an enemy turn when the enemy's current intent
  // was `block` and their block is now 0 — the player broke the shield, so
  // the enemy "spent" their turn recovering instead of acting. Drives the
  // "Staggered" banner + enemy-frame recoil.
  | { kind: 'enemy-staggered'; enemyId: string }
  | { kind: 'intent-telegraphed'; enemyId: string; intent: Intent }
  | { kind: 'extra-turn-granted' }
  | { kind: 'turn-ended' }
  | { kind: 'phase-changed'; phase: CombatPhase }
  | { kind: 'screen-shake'; magnitude: number }
  // Fired by the relic engine when a relic's hook actually mutates state /
  // emits a follow-up. UI uses it for the relic-tray pulse + future
  // battle log; `effect` is a short human label ("reflected 1 damage").
  | { kind: 'relic-triggered'; relicId: string; effect: string }
  | { kind: 'relic-gained'; relicId: string }
  // Emitted when a fight ends and a reward roll has been generated.
  // RewardScreen mounts on this; engine could also use it for run logging.
  | { kind: 'reward-offered'; offeredRelicIds: string[]; gold: number }
  // UI-only signal: the player's cursor is over a board cell (or
  // null = pointer left the board). Emitted by BoardScene when its
  // internal hoveredCell transitions. BurningOverlay listens to react
  // its flames in sync with the gem hover beat.
  | { kind: 'board-hover'; cell: Pos | null }
  // Emitted by BoardScene.performSwap once the AC has fully drained its
  // event queue AND a short cushion has elapsed for trailing FX (damage
  // popups drifting, kill pulses, cascade-complete chimes). Terminal-
  // state modals (victory / reward / game-over) listen for this so they
  // mount on a settled scene regardless of cascade length — long chains
  // get the full ride, short kills get a tight reveal.
  | { kind: 'gameplay-settled' }

export type CombatPhase =
  | 'player-acting'
  | 'enemy-acting'
  | 'victory'
  | 'game-over'

export type IntentKind =
  | 'attack'
  | 'block'
  | 'tile-burn'
  | 'heal-ally'
  | 'buff-ally'
  | 'shield-ally'
  | 'column-smash'
  | 'petrify-row'

// Optional status rider carried on attack intents. Smolder uses this
// to apply Burn on hit. Surfaced on the intent badge so the player
// sees the rider before the attack lands.
export type IntentOnHit = {
  status: StatusKind
  stacks: number
}

export type Intent =
  | { kind: 'attack'; amount: number; onHit?: IntentOnHit }
  | { kind: 'block'; amount: number }
  | { kind: 'tile-burn'; count: number }
  // Ally-target intents: the source enemy supports a sibling enemy.
  // `targetAllyId` is resolved at roll time (deterministic from rng).
  | { kind: 'heal-ally'; amount: number; targetAllyId: string }
  | { kind: 'buff-ally'; stacks: number; targetAllyId: string }
  | { kind: 'shield-ally'; amount: number; targetAllyId: string }
  // H2b board verbs: column / row resolved at roll time so the
  // telegraph can pre-flag the threatened cells (counter-play loop).
  | { kind: 'column-smash'; column: number }
  | { kind: 'petrify-row'; row: number }

export type EnemyArchetype = 'brute' | 'smolder' | 'skirmisher' | 'rallier' | 'defender'

export type PhasePools = {
  red: number
  blue: number
  green: number
}

// H3: Multi-color mana economy. Each match contributes both an immediate
// effect (today's PhasePools / mana / skillCharge behaviour) AND a
// persistent color mana pool that spells will cost from. Yellow is the
// "wild" color — substitutes for any cost at 1:1. Purple stays as
// ultimate charge (not in this pool).
export type ManaPools = {
  red: number
  blue: number
  green: number
  yellow: number
}

// Per-color caps. Color manas (R/B/G) cap at 8; wild mana (yellow) caps
// at 5 — lower because it's universally useful, so we don't want it to
// dominate the planning layer.
export const MANA_CAPS: Readonly<ManaPools> = {
  red: 8,
  blue: 8,
  green: 8,
  yellow: 5,
}

// Spell cost shape. Optional per-color costs; absent fields cost 0.
// Yellow when EXPLICITLY required (not as wild substitution) is for
// spells that thematically demand yellow as input (e.g. Focus). For
// normal spells, yellow is consumed via the wild-substitution rule.
export type ManaCost = {
  red?: number
  blue?: number
  green?: number
  yellow?: number
}

// One acquired relic in the player's inventory. Array order = acquisition
// order = modifier-chain evaluation order. `runFlags` persists across the
// whole run (Stoneheart.triggered); `fightFlags` is cleared by the
// onRoundStarted step at fight-start (none in Phase G, reserved for J2).
export type RelicInstance = {
  id: string
  runFlags: Record<string, JsonValue>
  fightFlags: Record<string, JsonValue>
}

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [k: string]: JsonValue }

export type Player = {
  hp: number
  maxHp: number
  block: number
  // H3: per-color mana pool. Replaces the single `mana: number` field.
  // Persists across fights within a run (wiped on restart). Yellow is
  // the wild color — see ManaCost wild-substitution rule.
  mana: ManaPools
  skillCharge: number
  phasePools: PhasePools
  statuses: StatusInstance[]
  // EOP/ultimate effects queued this phase. Bulwark/Reinforce fire and
  // are cleared at EOP; Riposte persists across the enemy turn until it
  // triggers on an incoming attack or expires at the end of that turn.
  // H4a: Bash/Volley join this list — both consume the red pool at EOP
  // (defer per-match red damage during the phase). They're mutually
  // exclusive (castSpell gates the second one).
  pendingSpells: PendingSpellId[]
  // H4a Volley arg payload: the 3 enemy ids the player chose at cast
  // time, one per hit. Lives on Player rather than the pending list
  // because PendingSpellId is just a discriminator. Cleared on EOP
  // resolution along with the pending entry.
  volleyTargets?: string[]
  // H4a redesign one-shot match modifiers. Both are consumed by the
  // next match the player makes (NOT cascades from that match — only
  // the first link). Cleared after the consuming match's deltas are
  // applied so a chain reaction can't burn through them.
  //   skewerArmed: red damage from the next match is doubled
  //   surgeArmed: the next match treats its cascadeLevel as level+2
  //               (so relic onMatch hooks like Cascade Crystal fire
  //               on a match that would normally be level 0)
  skewerArmed?: boolean
  surgeArmed?: boolean
  // Reinforce sets this at EOP. Next beginPlayerPhase preserves the
  // remaining block (instead of zeroing it) and clears the flag — the
  // phase *after* that zeros normally per 01-design §Reinforce.
  carryBlockNextPhase: boolean
  // Acquisition-ordered. Cleared on restart, grown by acquireRelic.
  relics: RelicInstance[]
}

// Rolled at fight-end from rng.loot; persists in the store while the
// player picks. Cleared by acquireRelic / skipReward.
export type PendingReward = {
  rarity: RelicRarity
  offeredRelicIds: string[]
  gold: number
}

export type RelicRarity = 'common' | 'uncommon' | 'rare'

export type Enemy = {
  id: string
  name: string
  archetype: EnemyArchetype
  hp: number
  maxHp: number
  block: number
  currentIntent: Intent
  nextIntentIndex: number
  statuses: StatusInstance[]
}

export type FightState = {
  phase: CombatPhase
  player: Player
  enemies: Enemy[]
  targetEnemyId: string | null
  // True for the boss-column node. Used to route the post-fight transition
  // to the run-victory screen instead of the reward roll.
  isBoss?: boolean
}

// H1: branching procedural map. Layout per 02-scope §Map structure —
// 4 encounter columns + boss column 5. Nodes are identified by stable
// string ids so save state can reference them later (K).
export type NodeKind = 'fight' | 'elite' | 'shop' | 'rest' | 'boss'

export type MapNode = {
  id: string
  kind: NodeKind
  column: number // 0..4 (0 = first encounter column, 4 = boss)
  // Lane index within the column. Lets MapScreen lay out nodes
  // vertically without re-deriving position from edges.
  lane: number
  // For fight/elite/boss nodes only. Rolled at map-gen time so save/load
  // (Phase K) keeps the matchup. Length-1 for col 0-1 + boss, length 2-3
  // for col 2-3 multi-enemy nodes. Order = visual left-to-right.
  archetypes?: EnemyArchetype[]
}

export type MapEdge = { from: string; to: string }

export type MapState = {
  nodes: MapNode[]
  edges: MapEdge[]
  // null before the player picks their first node; set on enterNode.
  currentNodeId: string | null
  // Acquisition order. Includes the current node once a fight resolves.
  completedNodeIds: string[]
}

// Run-level phase. Layered on top of CombatPhase: when runPhase==='fight',
// FightState.phase drives in-fight transitions. 'reward' mounts the
// existing RewardScreen modal. 'victory' is the run-cleared (boss-down)
// terminal state; 'game-over' is run-failed.
export type RunPhase = 'map' | 'fight' | 'reward' | 'victory' | 'game-over'
