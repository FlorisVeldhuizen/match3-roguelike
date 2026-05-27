import { subscribeGameEvents } from '../core/events/emitter'
import { readSpellVisualBeat } from '../core/combat/spellVisual'
import { statusKindFromDamageSource } from '../core/combat/statuses'
import { scheduleAfterMs, scheduleAtTrailArrival } from '../timing'
import { subscribeTrailScheduled } from '../trails/sync'
import type { StatusKind } from '../types'
import { playDropSfx } from './synths/drop'
import { playClackSfx } from './synths/match'
import { playCascadeChimeSfx, playCascadeCelebrationSfx } from './synths/cascade'
import { playAttackSfx } from './synths/attack'
import { playHealSfx } from './synths/heal'
import { playShieldThumpSfx, playShieldCrackSfx, playShieldParticleTickSfx } from './synths/shield'
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
import { playEnemyTurnSfx, playExtraTurnSfx, playTurnStartSfx } from './synths/turn'
import { playHexApplySfx, playHexExpireSfx, playHexTriggerSfx } from './synths/hex'
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
  let lastPlayerBlocked = 1
  let lastPlayerUnblocked = 1
  let lastEnemyBlocked = 1
  let lastEnemyUnblocked = 1
  let lastEnemyTurnCueAt = -Infinity
  let lastPoolBlueAmount = 0
  let lastTileBurnCellCount = 0
  let playerProcBlockPending = false
  let playerProcBlockSfx: 'absorbed' | 'broken' | null = null

  const FALL_MIN_MS = 150
  const FALL_PER_CELL_MS = 80
  const scheduleDrop = (maxDist: number) => {
    const fallMs = Math.max(FALL_MIN_MS, FALL_PER_CELL_MS * maxDist)
    window.setTimeout(playDropSfx, fallMs)
  }

  subscribeTrailScheduled((trail) => {
    const { arrivalMs, purpose } = trail
    switch (purpose) {
      case 'status-proc': {
        if (trail.statusKind === 'burn' && trail.procFacet === 'damage') {
          const amt = trail.target === 'player' ? lastPlayerUnblocked : lastEnemyUnblocked
          if (amt > 0) {
            scheduleAfterMs(() => playBurnImpactSfx(amt), arrivalMs)
          }
        }
        if (trail.procFacet === 'block') {
          if (trail.target === 'player') {
            const kind = playerProcBlockSfx
            playerProcBlockSfx = null
            scheduleAfterMs(() => {
              if (kind === 'absorbed') playShieldThumpSfx(lastPlayerBlocked)
              else if (kind === 'broken') {
                playShieldCrackSfx(lastPlayerBlocked + lastPlayerUnblocked)
              }
            }, arrivalMs)
          } else {
            scheduleAfterMs(() => playShieldThumpSfx(lastEnemyBlocked), arrivalMs)
          }
        }
        return
      }
      case 'pool-earn': {
        if (trail.earnDest === 'mana') return
        const blueAmt = trail.color === 'blue' ? (trail.amount ?? lastPoolBlueAmount) : 0
        if (blueAmt > 0) {
          scheduleAfterMs(() => playShieldParticleTickSfx(blueAmt), arrivalMs)
        }
        return
      }
      case 'status-apply': {
        const sfx = trail.statusKind != null ? STATUS_APPLY_SFX[trail.statusKind] : undefined
        if (sfx) scheduleAfterMs(sfx, arrivalMs)
        return
      }
      case 'verb-to-board':
        if (trail.verb === 'tile-burn' && lastTileBurnCellCount > 0) {
          scheduleAfterMs(() => playBurnIgniteSfx(lastTileBurnCellCount), arrivalMs)
        } else if (trail.verb === 'color-hex') {
          scheduleAfterMs(playHexApplySfx, arrivalMs)
        } else if (trail.verb === 'petrify') {
          scheduleAfterMs(() => playShieldThumpSfx(6), arrivalMs)
        }
        return
      default:
        return
    }
  })

  subscribeGameEvents((event) => {
    switch (event.kind) {
      case 'gems-cleared':
        if (event.cells.length > 0) playClackSfx(event.cells.length)
        return
      case 'gems-fell':
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
        if (event.level >= 1) playCascadeChimeSfx(event.level)
        return
      case 'cascade-complete':
        if (event.levels >= 3) {
          const lv = event.levels
          window.setTimeout(() => playCascadeCelebrationSfx(lv), 220)
        }
        return
      case 'damage-dealt': {
        const amt = event.amount
        const procKind = statusKindFromDamageSource(event.source)
        if (procKind) {
          lastEnemyBlocked = event.blocked
          lastEnemyUnblocked = event.amount
          return
        }
        if (event.source === 'player-attack') {
          lastEnemyBlocked = event.blocked
          lastEnemyUnblocked = event.amount
          const beat = readSpellVisualBeat(event)
          if (amt > 0) {
            if (beat) {
              scheduleAfterMs(() => playAttackSfx(amt), beat.arriveMs)
            } else {
              scheduleAtTrailArrival(() => playAttackSfx(amt))
            }
          }
        } else if (amt > 0) {
          playAttackSfx(amt)
        }
        return
      }
      case 'healed': {
        const amt = event.amount
        const beat = readSpellVisualBeat(event)
        const delay = beat?.arriveMs ?? undefined
        if (delay != null) scheduleAfterMs(() => playHealSfx(amt), delay)
        else scheduleAtTrailArrival(() => playHealSfx(amt))
        return
      }
      case 'pool-gained':
        if (event.color === 'blue') lastPoolBlueAmount = event.amount
        return
      case 'damage-taken': {
        const procKind = statusKindFromDamageSource(event.source)
        lastPlayerBlocked = event.blocked
        lastPlayerUnblocked = event.amount
        if (procKind) {
          if (event.blocked > 0) playerProcBlockPending = true
          return
        }
        if (event.amount > 0) playAttackSfx(event.amount)
        return
      }
      case 'block-absorbed':
        if (event.targetId === 'player') {
          if (playerProcBlockPending) {
            playerProcBlockSfx = 'absorbed'
            playerProcBlockPending = false
          }
        } else {
          scheduleAtTrailArrival(() => playShieldThumpSfx(lastEnemyBlocked))
        }
        return
      case 'block-broken':
        if (event.targetId === 'player') {
          if (playerProcBlockPending) {
            playerProcBlockSfx = 'broken'
            playerProcBlockPending = false
          } else if (playerProcBlockSfx == null) {
            playShieldCrackSfx(lastPlayerBlocked + lastPlayerUnblocked)
          }
        } else {
          scheduleAtTrailArrival(() => playShieldCrackSfx(lastEnemyBlocked + lastEnemyUnblocked))
        }
        return
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
      case 'tile-burn-placed':
        lastTileBurnCellCount = event.cells.length
        return
      case 'tile-burn-triggered':
        playBurnBurstSfx(event.cells.length)
        return
      case 'cell-flag-ticked':
        if (event.flag === 'burning' && event.expired.length > 0) {
          playBurnFizzleSfx(event.expired.length)
        }
        return
      case 'status-applied': {
        if (event.source?.kind === 'enemy') {
          const sfx = STATUS_APPLY_SFX[event.status.kind]
          sfx?.()
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
        } else if (event.phase === 'player-acting') {
          const sinceEnemy = performance.now() - lastEnemyTurnCueAt
          if (sinceEnemy > 700) playTurnStartSfx()
        }
        return
      default:
        return
    }
  })
}
