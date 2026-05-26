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

// STANDIN entries reuse closest-semantic synths until dedicated ones land.
const STATUS_APPLY_SFX: Partial<Record<StatusKind, () => void>> = {
  burn: playBurnApplySfx,
  weak: playStaggeredSfx,
  vulnerable: playShieldCrackSfx,
  strength: playShieldThumpSfx,
  regen: playHealSfx,
}

let installed = false
export function installSfxBindings(): void {
  if (installed) return
  installed = true
  // Stash blocked/unblocked per side so block-absorbed/broken can scale correctly.
  let lastPlayerBlocked = 1
  let lastPlayerUnblocked = 1
  let lastEnemyBlocked = 1
  let lastEnemyUnblocked = 1
  // -Infinity so the first player-turn cue is never suppressed.
  let lastEnemyTurnCueAt = -Infinity
  // When a proc has a block component, defer shield SFX to trail-arrival.
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
        // Delay so the thump lands when gems visibly hit the board.
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
        playDropSfx()
        return
      case 'gems-spawned':
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
        // Skip level 0 — the clear SFX already covers the initial match.
        if (event.level >= 1) playCascadeChimeSfx(event.level)
        return
      case 'cascade-complete':
        // Threshold 3 = at least two chained cascades on top of the initial match.
        if (event.levels >= 3) {
          const lv = event.levels
          window.setTimeout(() => playCascadeCelebrationSfx(lv), 220)
        }
        return
      case 'damage-dealt': {
        // Delay player-attack SFX to trail arrival to match visual hit timing.
        const amt = event.amount
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
        const amt = event.amount
        scheduleAtTrailArrival(() => playHealSfx(amt))
        return
      }
      case 'pool-gained': {
        if (event.color === 'blue') {
          const amt = event.amount
          scheduleAtTrailArrival(() => playShieldParticleTickSfx(amt))
        }
        return
      }
      case 'damage-taken': {
        const procKind = statusKindFromDamageSource(event.source)
        if (procKind && (event.amount > 0 || event.blocked > 0)) {
          if (procKind === 'burn' && event.amount > 0) {
            scheduleAtTrailArrival(() => playBurnImpactSfx(event.amount))
          }
          lastPlayerBlocked = event.blocked
          lastPlayerUnblocked = event.amount
          if (event.blocked > 0) pendingProcBlockSfx = true
          return
        }
        lastPlayerBlocked = event.blocked
        lastPlayerUnblocked = event.amount
        if (event.amount > 0) {
          playAttackSfx(event.amount)
        }
        return
      }
      case 'block-absorbed': {
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
        playStaggeredSfx()
        return
      case 'enemy-block-gained':
        playShieldThumpSfx(event.amount)
        return
      case 'board-shuffled':
        playShuffleSfx()
        return
      case 'column-smash-resolved':
        if (event.cells.length > 0) playSmashSfx()
        return
      case 'petrify-fired':
        scheduleAtTrailArrival(() => playShieldThumpSfx(6))
        return
      case 'color-hex-fired':
        scheduleAtTrailArrival(() => playHexApplySfx())
        return
      case 'hex-triggered':
        playHexTriggerSfx(event.stacks)
        return
      case 'color-hex-ticked':
        if (event.remaining === 0) playHexExpireSfx()
        return
      case 'cluster-shove-resolved':
        if (event.moves.length > 0) playShoveSfx(event.moves.length)
        return
      case 'petrify-row-ticked':
        if (event.remaining === 0) playShieldCrackSfx(1)
        return
      case 'tile-burn-placed': {
        const ct = event.cells.length
        scheduleAtTrailArrival(() => playBurnIgniteSfx(ct))
        return
      }
      case 'tile-burn-triggered':
        playBurnBurstSfx(event.cells.length)
        return
      case 'cell-flag-ticked':
        if (event.flag === 'burning' && event.expired.length > 0) {
          playBurnFizzleSfx(event.expired.length)
        }
        return
      case 'status-applied': {
        // Enemy-source applies play immediately (no trail); others ride trail-arrival.
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
        playExtraTurnSfx()
        return
      case 'phase-changed':
        if (event.phase === 'victory') playVictorySfx()
        else if (event.phase === 'enemy-acting') {
          playEnemyTurnSfx()
          lastEnemyTurnCueAt = performance.now()
        }
        // Suppress when enemy cue just fired (<700ms) to avoid doubled cues on stagger.
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
