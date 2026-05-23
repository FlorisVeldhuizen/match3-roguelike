// Public audio API — barrel that re-exports from the split modules.
//
// This file used to hold ~2800 lines of WebAudio synthesis. It's now a flat
// re-export of:
//
//   context.ts          — mute, volume, AudioContext, unlock, master compressor
//   utils.ts            — jitter, intensity, noise pool, schedRingPartial
//   bindings.ts         — installSfxBindings (the big event-switch)
//   synths/drop.ts      — drop variants + picker
//   synths/match.ts     — match-clear variants + picker + coin ping
//   synths/heal.ts      — heal variants + picker
//   synths/turn.ts      — turn-start, enemy-turn, extra-turn variants + pickers
//   synths/cascade.ts   — chime + celebration
//   synths/shield.ts    — thump + crack + particle tick
//   synths/burn.ts      — ignite, burst, apply, fizzle, impact
//   synths/attack.ts    — attack
//   synths/shuffle.ts   — shuffle
//   synths/victory.ts   — victory
//   synths/staggered.ts — staggered
//
// Callers import from `audio/sfx` exactly as before — this barrel keeps the
// public surface identical so the split is a pure refactor.

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

export {
  playDropSfx,
  previewDropVariant,
  getDropVariant,
  setDropVariant,
  subscribeDropVariant,
  DROP_VARIANTS,
  type DropVariant,
} from './synths/drop'

export {
  playClackSfx,
  previewMatchVariant,
  getMatchVariant,
  setMatchVariant,
  subscribeMatchVariant,
  MATCH_VARIANTS,
  type MatchVariant,
  playCoinPingSfx,
} from './synths/match'

export {
  playHealSfx,
  previewHealVariant,
  getHealVariant,
  setHealVariant,
  subscribeHealVariant,
  HEAL_VARIANTS,
  type HealVariant,
} from './synths/heal'

export {
  playTurnStartSfx,
  previewTurnStartVariant,
  getTurnStartVariant,
  setTurnStartVariant,
  subscribeTurnStartVariant,
  TURN_START_VARIANTS,
  type TurnStartVariant,
  playEnemyTurnSfx,
  previewEnemyTurnVariant,
  getEnemyTurnVariant,
  setEnemyTurnVariant,
  subscribeEnemyTurnVariant,
  ENEMY_TURN_VARIANTS,
  type EnemyTurnVariant,
  playExtraTurnSfx,
} from './synths/turn'

export {
  playCascadeChimeSfx,
  playCascadeCelebrationSfx,
} from './synths/cascade'

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
