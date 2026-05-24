// Public audio API — barrel that re-exports from the split modules.
//
// Callers import from `audio/sfx` so the underlying split stays an
// internal refactor concern.

export {
  isMuted,
  setMuted,
  subscribeMuted,
  getVolume,
  setVolume,
  subscribeVolume,
  unlockAudio,
} from './context'

export { installSfxBindings } from './bindings'

export { playDropSfx } from './synths/drop'
export { playClackSfx, playCoinPingSfx } from './synths/match'
export { playHealSfx } from './synths/heal'
export {
  playTurnStartSfx,
  playEnemyTurnSfx,
  playExtraTurnSfx,
} from './synths/turn'
export { playCascadeChimeSfx, playCascadeCelebrationSfx } from './synths/cascade'
export {
  playShieldThumpSfx,
  playShieldCrackSfx,
  playShieldParticleTickSfx,
} from './synths/shield'
export {
  playBurnIgniteSfx,
  playBurnBurstSfx,
  playBurnApplySfx,
  playBurnFizzleSfx,
  playBurnImpactSfx,
} from './synths/burn'
export { playAttackSfx } from './synths/attack'
export { playShuffleSfx } from './synths/shuffle'
export { playVictorySfx } from './synths/victory'
export { playStaggeredSfx } from './synths/staggered'
