// Wire game events → SFX dispatch. This is the single subscriber of the
// game-event stream from the audio side; every "play X cue when Y happens"
// rule lives here. Kept in one switch so the audio reactions are easy to
// audit and reorder in one place.

import { subscribeGameEvents } from '../core/events/emitter'
import { scheduleAtTrailArrival } from '../timing'
import { statusKindFromDamageSource } from '../core/combat/statuses'
import type { StatusKind } from '../types'
import { playDropSfx } from './synths/drop'
import { playClackSfx } from './synths/match'
import { playCascadeChimeSfx, playCascadeCelebrationSfx } from './synths/cascade'
import { playAttackSfx } from './synths/attack'
import { playHealSfx } from './synths/heal'
import {
  playShieldThumpSfx,
  playShieldCrackSfx,
  playShieldParticleTickSfx,
} from './synths/shield'
import { playStaggeredSfx } from './synths/staggered'
import { playShuffleSfx } from './synths/shuffle'
import { playVictorySfx } from './synths/victory'
import {
  playBurnIgniteSfx,
  playBurnBurstSfx,
  playBurnApplySfx,
  playBurnFizzleSfx,
  playBurnImpactSfx,
} from './synths/burn'
import {
  playEnemyTurnSfx,
  playExtraTurnSfx,
  playTurnStartSfx,
} from './synths/turn'
import {
  playHexApplySfx,
  playHexExpireSfx,
  playHexTriggerSfx,
} from './synths/hex'
import { playShoveSfx } from './synths/shove'
import { playSmashSfx } from './synths/smash'

// Per-status arrival cue. Keyed by StatusKind so adding a new status's
// apply sound is a one-line registration. The status-applied case below
// schedules the registered callback at the right beat based on whether
// a particle trail is flying.
//
// STANDIN entries below reuse the closest-semantic existing synths so
// every applied status has audible feedback while real per-status
// timbres are designed. Replace each with a dedicated `play<X>ApplySfx`
// when the flavor work lands — burn is the reference (bonfire / furnace
// / fizzle multi-synth set in `src/audio/synths/burn.ts`).
const STATUS_APPLY_SFX: Partial<Record<StatusKind, () => void>> = {
  burn: playBurnApplySfx,
  weak: playStaggeredSfx, // STANDIN — staggered/weakened semantic overlap
  vulnerable: playShieldCrackSfx, // STANDIN — armor-crack = exposed
  strength: playShieldThumpSfx, // STANDIN — assertive thump
  regen: playHealSfx, // STANDIN — heal-adjacent (Cleanse cast already has its own SFX)
}

// Idempotent — calling install() twice is safe.
let installed = false
export function installSfxBindings(): void {
  if (installed) return
  installed = true
  // `block-absorbed`/`block-broken` don't carry the blocked amount, but they
  // fire immediately after their paired damage event. For enemy attacks on
  // the player that's `damage-taken` (enemyTurn.ts); for player attacks on
  // an enemy that's `damage-dealt` with source='player-attack' (store.ts).
  // Stash each side separately so a player breaking an enemy shield doesn't
  // scale from stale values left over from the previous enemy turn.
  let lastPlayerBlocked = 1
  let lastPlayerUnblocked = 1
  let lastEnemyBlocked = 1
  let lastEnemyUnblocked = 1
  // Tracks when the enemy-turn cue last fired so we can suppress the
  // immediately-following player-turn cue when the enemy gets staggered
  // (or otherwise skips). performance.now() is monotonic; -Infinity means
  // "never fired", so the first player-turn cue is never suppressed.
  let lastEnemyTurnCueAt = -Infinity
  // Mirrors AC.pendingProcBlockDelay — when a proc damage event has a
  // block component, the upcoming block-absorbed/broken event's shield
  // SFX should defer to trail-arrival rather than fire at t=0 (before
  // the chip→block particles visibly arrive). Consumed by the next
  // block-absorbed/broken handler.
  let pendingProcBlockSfx = false
  const FALL_MIN_MS = 150
  const FALL_PER_CELL_MS = 80
  const scheduleDrop = (maxDist: number) => {
    const fallMs = Math.max(FALL_MIN_MS, FALL_PER_CELL_MS * maxDist)
    window.setTimeout(playDropSfx, fallMs)
  }
  subscribeGameEvents((event) => {
    switch (event.kind) {
      case 'gems-cleared':
        if (event.cells.length > 0) playClackSfx(event.cells.length)
        return
      case 'gems-fell':
        // One thunk per event, not per gem — otherwise a fully-cleared row
        // plays a stack of overlapping thunks. Delay matches the longest
        // gem's fall duration so the thump lands when the gems visibly hit
        // the board, not when the event fires at the start of the animation.
        if (event.movements.length > 0) {
          let maxDist = 0
          for (const m of event.movements) {
            const d = Math.abs(m.to.y - m.from.y)
            if (d > maxDist) maxDist = d
          }
          scheduleDrop(maxDist)
        }
        return
      case 'board-intro-landed':
        // Level-start intro emits one of these per column, already scheduled
        // by the animator to fire at that column's visual touchdown. Just
        // play the thunk — no extra timing math.
        playDropSfx()
        return
      case 'gems-spawned':
        // Spawned gems fall in alongside gems-fell (AnimationController runs
        // animateFall and animateSpawn in parallel), so this thunk fires near
        // the fall thunk. Spawn fall distance is usually larger (gems enter
        // from above the board), so the spawn thunk still lands slightly
        // later. Spawn at y starts (y+1) cells above the board.
        if (event.spawns.length > 0) {
          let maxDist = 0
          for (const s of event.spawns) {
            const d = s.at.y + 1
            if (d > maxDist) maxDist = d
          }
          scheduleDrop(maxDist)
        }
        return
      case 'cascade-start':
        // Skip the first cascade-start (level 0) — the clear SFX already
        // sells the initial match. Only the chain triggers the cascade chime.
        // Pitch climbs per level so a long chain audibly ascends.
        if (event.level >= 1) playCascadeChimeSfx(event.level)
        return
      case 'cascade-complete':
        // Celebration flourish after a "good" chain. Threshold of 3 means
        // the player got at least two chained cascades on top of the
        // initial match — a clearly intentional combo, worth rewarding.
        // Delay slightly so it lands cleanly after the last per-step chime.
        if (event.levels >= 3) {
          const lv = event.levels
          window.setTimeout(() => playCascadeCelebrationSfx(lv), 220)
        }
        return
      case 'damage-dealt': {
        // Player-attack damage commits per-match during the cascade, but the
        // visual hit lands later when the red gem trail reaches the enemy.
        // Delay the SFX to match — the AnimationController applies the same
        // offset to the damage popup. Other damage sources don't have
        // travel time, so play immediately. Pass the amount so big hits
        // sound heavier than small ones.
        //
        // Also stash blocked/amount so the block-absorbed/block-broken event
        // that follows (for enemy targets) can scale itself correctly.
        const amt = event.amount
        // Status proc on an enemy (Burn etc.): impact-only at trail
        // arrival. The apply cue (bonfire) is reserved for the moment
        // Burn is FIRST applied (Smolder rider, board-cells match) —
        // playing it on every tick stacked two sustained fire roars
        // back-to-back and read as "the same sound twice".
        const procKind = statusKindFromDamageSource(event.source)
        if (procKind && amt > 0) {
          if (procKind === 'burn') {
            scheduleAtTrailArrival(() => playBurnImpactSfx(amt))
          }
          return
        }
        if (event.source === 'player-attack') {
          lastEnemyBlocked = event.blocked
          lastEnemyUnblocked = event.amount
          if (amt > 0) scheduleAtTrailArrival(() => playAttackSfx(amt))
        } else if (amt > 0) {
          playAttackSfx(amt)
        }
        return
      }
      case 'healed': {
        // Delay so the cue lands when the green trail visibly hits the HP
        // bar, not at gem-match time. Bigger heals → louder, fizzier.
        const amt = event.amount
        scheduleAtTrailArrival(() => playHealSfx(amt))
        return
      }
      case 'pool-gained': {
        // Blue particles land on the block badge — play a "tink" on arrival.
        // Scale with the amount: 6-armor lands chunkier than 1-armor.
        if (event.color === 'blue') {
          const amt = event.amount
          scheduleAtTrailArrival(() => playShieldParticleTickSfx(amt))
        }
        return
      }
      case 'damage-taken': {
        // Status proc on the player (Burn etc.): impact-only at trail
        // arrival. See the matching damage-dealt note above — playing
        // both apply (bonfire) and impact (furnace) on a tick stacks
        // two long fire roars and reads as a doubled cue.
        const procKind = statusKindFromDamageSource(event.source)
        if (procKind && (event.amount > 0 || event.blocked > 0)) {
          if (procKind === 'burn' && event.amount > 0) {
            scheduleAtTrailArrival(() => playBurnImpactSfx(event.amount))
          }
          // Stash so the upcoming block-absorbed/broken event scales
          // its shield SFX from the correct value (the proc branch
          // previously didn't stash these — block SFX could scale
          // from a stale enemy-attack value).
          lastPlayerBlocked = event.blocked
          lastPlayerUnblocked = event.amount
          // Tell the upcoming block-absorbed/broken handler to defer
          // its shield SFX to trail-arrival — particles take 700ms to
          // visibly hit the block badge, the SFX should land with them.
          if (event.blocked > 0) pendingProcBlockSfx = true
          return
        }
        // Regular enemy-attack damage. Without this, unblocked hits on
        // the player would be silent — the shield SFX only fires when
        // block is in play. Stash both amounts so the upcoming
        // block-absorbed/broken event can scale itself.
        lastPlayerBlocked = event.blocked
        lastPlayerUnblocked = event.amount
        if (event.amount > 0) {
          playAttackSfx(event.amount)
        }
        return
      }
      case 'block-absorbed': {
        // Player target (enemy attack): shield SFX usually fires
        // immediately to land with the synchronous shield visual. When
        // a proc damage event preceded this (chip→block particle
        // trail in flight), defer to trail-arrival so the SFX lands
        // with the particles' visible impact instead of 700ms ahead.
        // Enemy target (player attack): always trail-arrival-delayed
        // (red gem trail mirror).
        if (event.targetId === 'player') {
          const amt = lastPlayerBlocked
          if (pendingProcBlockSfx) {
            pendingProcBlockSfx = false
            scheduleAtTrailArrival(() => playShieldThumpSfx(amt))
          } else {
            playShieldThumpSfx(amt)
          }
        } else {
          const amt = lastEnemyBlocked
          scheduleAtTrailArrival(() => playShieldThumpSfx(amt))
        }
        return
      }
      case 'block-broken': {
        // Same target-split timing as block-absorbed. Scale by total
        // incoming damage so a shield breaking under a 6-damage hit
        // cracks harder than one breaking under a 1-damage finisher.
        if (event.targetId === 'player') {
          const amt = lastPlayerBlocked + lastPlayerUnblocked
          if (pendingProcBlockSfx) {
            pendingProcBlockSfx = false
            scheduleAtTrailArrival(() => playShieldCrackSfx(amt))
          } else {
            playShieldCrackSfx(amt)
          }
        } else {
          const amt = lastEnemyBlocked + lastEnemyUnblocked
          scheduleAtTrailArrival(() => playShieldCrackSfx(amt))
        }
        return
      }
      case 'enemy-staggered':
        // Plays alongside the "Staggered" banner. Lands after the shield-
        // crack already cued the break — this is the follow-up "reeling"
        // beat, not the impact itself.
        playStaggeredSfx()
        return
      case 'enemy-block-gained':
        // Shield going up on the enemy. Reuses the impact thump for now —
        // a dedicated "raise" cue would read more accurately, but the thump
        // is close enough in palette to sell "shield" without a new synth.
        // Scale by the amount of block gained.
        playShieldThumpSfx(event.amount)
        return
      case 'board-shuffled':
        playShuffleSfx()
        return
      case 'column-smash-resolved':
        // Brute's column-smash impact — dedicated low-thud + rubble
        // crackle synth. Pairs with the magnitude-1.1 screen-shake
        // emitted alongside this event by AnimationController. No
        // delay: the smash IS the moment of impact, no chip-arrival
        // hand-off to align with.
        if (event.cells.length > 0) playSmashSfx()
        return
      case 'petrify-fired':
        // Defender's lockout lands. Stone particles fly enemy → row
        // cells (AnimationController) and the grey wash appears at
        // arrival (PetrifyOverlay), so the slam cue is scheduled to
        // the same TRAIL_ARRIVAL_MS beat — sound, visual and chip
        // all hit together. shield-thump scaled up still works as
        // a placeholder (heavy thud character); swap for a dedicated
        // stone-slam synth in a future audio pass.
        scheduleAtTrailArrival(() => playShieldThumpSfx(6))
        return
      case 'color-hex-fired':
        // Caster's hex lands. Same trail-arrival hand-off as petrify:
        // arcane particles fly enemy → gems and the ring overlay
        // appears at TRAIL_ARRIVAL_MS — the apply cue lands then so
        // sound + visual + chip all sync.
        scheduleAtTrailArrival(() => playHexApplySfx())
        return
      case 'hex-triggered':
        // Player matched a hexed-colour gem; Weak just applied.
        // Brief zap scaled by stacks (= cells.length of the match)
        // so a 5-line through hexed reds is audibly heavier than a
        // 3-match. Fires inline at event time — same beat as the
        // pool-gained chime; no trail-arrival delay (the curse is
        // already on the board, this is the player tripping it).
        playHexTriggerSfx(event.stacks)
        return
      case 'color-hex-ticked':
        // Release cue when the hex's last turn ticks down. Mirrors
        // petrify-row-ticked's release-only gate: silent on
        // remaining > 0, brief upward shimmer on remaining === 0.
        if (event.remaining === 0) playHexExpireSfx()
        return
      case 'cluster-shove-resolved':
        // Swarmer's gems land. Whoosh + thud synth scaled by surviving
        // move count so multi-swarmer clusters sound heavier than a
        // single shove. No trail-arrival delay — the shove is the
        // particles-and-gems landing, not a chip-application beat.
        if (event.moves.length > 0) playShoveSfx(event.moves.length)
        return
      case 'petrify-row-ticked':
        // Release cue when a row's lockout expires (remaining hit 0).
        // shield-crack reads as "stone breaking apart" — sharper and
        // more event-y than the burn-fizzle placeholder, which felt
        // too soft / wrong-family for a rock-shattering release.
        // Tick events with remaining > 0 are silent — only the
        // release moment plays.
        if (event.remaining === 0) playShieldCrackSfx(1)
        return
      case 'tile-burn-placed': {
        // Smolder lights cells. Particles fly enemy → cells and the
        // flame appears at arrival, so the ignite cue lands then too.
        const ct = event.cells.length
        scheduleAtTrailArrival(() => playBurnIgniteSfx(ct))
        return
      }
      case 'tile-burn-triggered':
        // One cue per match, scaled by cell count (intensity). Previously
        // we played N staggered bursts at 35ms apart, which sample-looped
        // into a muddy "buzz" on multi-cell clears. Visual still shows N
        // bursts on the board; one audio impact reads as the unified
        // moment without crowding the rest of the cascade soundtrack.
        playBurnBurstSfx(event.cells.length)
        return
      case 'cell-flag-ticked':
        // Soft "fizzle out" cue when a burning tile's countdown reached
        // 0 unmatched. One cue per tick regardless of how many cells
        // expired (the visual already shows N puffs); a single hiss
        // scaled by count keeps the audio bed clean at end-of-turn.
        if (event.flag === 'burning' && event.expired.length > 0) {
          playBurnFizzleSfx(event.expired.length)
        }
        return
      case 'status-applied': {
        // Universal arrival cue dispatch. Look up the per-status sound
        // and fire it at the visual impact moment — when the chip's
        // particle trail lands. AC suppresses the trail for enemy-source
        // applies (the attack's own carrier visuals cover that beat), so
        // we play immediately — same tick as the damage-taken event that
        // just fired, which lands the sound on the impact. For every
        // other source (board-cells / player-cast / undefined) the trail
        // is in flight, so we ride the same TRAIL_ARRIVAL_MS schedule
        // and the sound lands with the particles on the chip.
        const sfx = STATUS_APPLY_SFX[event.status.kind]
        if (!sfx) return
        if (event.source && event.source.kind !== 'enemy') {
          scheduleAtTrailArrival(sfx)
        } else {
          sfx()
        }
        return
      }
      case 'extra-turn-granted':
        // Plays alongside the "+1 TURN" callout. Brighter than turn-start
        // because it's a reward; sparkle layer reinforces "this was a treat".
        playExtraTurnSfx()
        return
      case 'phase-changed':
        if (event.phase === 'victory') playVictorySfx()
        else if (event.phase === 'enemy-acting') {
          playEnemyTurnSfx()
          lastEnemyTurnCueAt = performance.now()
        }
        // Begin-of-turn cue on every transition back to player-acting. The
        // very first turn of a fight is set up without emitting a phase-
        // changed event (initial state is constructed directly), so the cue
        // first fires from turn 2 onward — fine, since the player already
        // has visual context that the fight started.
        //
        // Suppress when the enemy cue just fired (stagger / instant-skip
        // turns): playing two opposite cues in <600ms is audibly awkward,
        // and the "Staggered" banner already tells the story. Player gets
        // their turn back silently in that case.
        else if (event.phase === 'player-acting') {
          const sinceEnemy = performance.now() - lastEnemyTurnCueAt
          if (sinceEnemy > 700) playTurnStartSfx()
        }
        return
      default:
        return
    }
  })
}
