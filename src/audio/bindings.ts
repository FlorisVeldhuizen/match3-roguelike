// Wire game events → SFX dispatch. This is the single subscriber of the
// game-event stream from the audio side; every "play X cue when Y happens"
// rule lives here. Kept in one switch so the audio reactions are easy to
// audit and reorder in one place.

import { subscribeGameEvents } from '../core/events/emitter'
import { scheduleAtTrailArrival } from '../timing'
import { statusKindFromDamageSource } from '../core/combat/statuses'
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
        // Status proc on an enemy (Burn etc.): per-status whoosh on
        // spawn + per-status impact at trail arrival. Keeps the cue
        // family coherent — burn damage sounds like burn, not a
        // generic attack.
        const procKind = statusKindFromDamageSource(event.source)
        if (procKind && amt > 0) {
          if (procKind === 'burn') {
            playBurnApplySfx()
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
        // Status proc on the player (Burn etc.): play the whoosh on
        // spawn, the burn impact at trail arrival.
        // AnimationController.spawnStatusProcTrail fires particles
        // chip → HP at the same beat.
        const procKind = statusKindFromDamageSource(event.source)
        if (procKind && event.amount > 0) {
          if (procKind === 'burn') {
            playBurnApplySfx()
            scheduleAtTrailArrival(() => playBurnImpactSfx(event.amount))
          }
          return
        }
        // Regular enemy-attack damage. Without this, unblocked hits on
        // the player would be silent — the shield SFX only fires when
        // block is in play. Stash both amounts so the upcoming
        // block-absorbed/broken event can scale itself.
        lastPlayerBlocked = event.blocked
        lastPlayerUnblocked = event.amount
        if (event.amount > 0) playAttackSfx(event.amount)
        return
      }
      case 'block-absorbed': {
        // Player target (enemy attacking): the shield-block visual fires
        // synchronously and the damage-taken SFX also plays immediately,
        // so play the thump now too — lands with the visual, ahead of any
        // leaked damage SFX. Enemy target (player attacking): the red gem
        // trail arrives at +TRAIL_ARRIVAL_MS, so delay both to land with
        // the attack rather than at gem-match time.
        if (event.targetId === 'player') {
          playShieldThumpSfx(lastPlayerBlocked)
        } else {
          const amt = lastEnemyBlocked
          scheduleAtTrailArrival(() => playShieldThumpSfx(amt))
        }
        return
      }
      case 'block-broken': {
        // Same target-split timing as block-absorbed. Scale by total
        // incoming damage so a shield breaking under a 6-damage hit cracks
        // harder than one breaking under a 1-damage finisher.
        if (event.targetId === 'player') {
          playShieldCrackSfx(lastPlayerBlocked + lastPlayerUnblocked)
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
      case 'tile-burn-placed': {
        // Smolder lights cells. Particles fly enemy → cells and the
        // flame appears at arrival, so the ignite cue lands then too.
        const ct = event.cells.length
        scheduleAtTrailArrival(() => playBurnIgniteSfx(ct))
        return
      }
      case 'tile-burn-triggered':
        // Each burning cell cleared in a match → one burst. Stagger by
        // a few ms so multi-cell clears don't sample-loop into a single
        // unsatisfying thwack.
        for (let i = 0; i < event.cells.length; i++) {
          window.setTimeout(playBurnBurstSfx, i * 35)
        }
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
      case 'status-applied':
        // Burn arrival cue — short flame whoosh. Delayed via the same
        // trail-arrival schedule so the sound lands with the particle
        // hand-off and the status chip, not at swap commit.
        // (Vulnerable/Weak applications are silent for now; can get
        // their own timbres later.)
        if (event.status.kind === 'burn') {
          if (
            event.source?.kind === 'enemy' ||
            event.source?.kind === 'board-cells'
          ) {
            scheduleAtTrailArrival(playBurnApplySfx)
          } else {
            playBurnApplySfx()
          }
        }
        return
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
