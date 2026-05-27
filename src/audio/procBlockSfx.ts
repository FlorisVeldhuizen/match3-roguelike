import { TRAIL_MAX_MS, TRAIL_PARTICLE_STAGGER_MS, scheduleAfterMs } from '../timing'

/** @see STATUS_AUDIO.md — proc block facet (DoT tick → armor), distinct from apply and proc damage. */

/** Latest moment a status-proc block trail should land; backup fires if trail audio never claims. */
export const PROC_BLOCK_TRAIL_BACKUP_MS = TRAIL_MAX_MS + TRAIL_PARTICLE_STAGGER_MS + 80

export type ProcBlockSfxKind = 'absorbed' | 'broken' | null

export type ProcBlockAudioSlot = {
  sfx: ProcBlockSfxKind
  claimed: boolean
  backupTimer: ReturnType<typeof setTimeout> | null
}

export function createProcBlockAudioSlot(): ProcBlockAudioSlot {
  return { sfx: null, claimed: false, backupTimer: null }
}

export function cancelProcBlockBackup(slot: ProcBlockAudioSlot): void {
  if (slot.backupTimer != null) {
    clearTimeout(slot.backupTimer)
    slot.backupTimer = null
  }
}

export function resetProcBlockSlot(slot: ProcBlockAudioSlot): void {
  slot.sfx = null
  slot.claimed = false
  cancelProcBlockBackup(slot)
}

/** Shield SFX for status-proc block trails when block-* events may be missing. */
export function resolveProcBlockSound(
  kind: ProcBlockSfxKind,
  blocked: number,
  hpDamage: number,
): 'thump' | 'crack' | null {
  if (kind === 'absorbed') return blocked > 0 ? 'thump' : null
  if (kind === 'broken') return blocked + hpDamage > 0 ? 'crack' : null
  if (blocked <= 0) return null
  return hpDamage > 0 ? 'crack' : 'thump'
}

export function playProcBlockSfx(
  kind: ProcBlockSfxKind,
  blocked: number,
  hpDamage: number,
  playThump: (amount: number) => void,
  playCrack: (amount: number) => void,
): void {
  const sound = resolveProcBlockSound(kind, blocked, hpDamage)
  if (sound === 'thump') playThump(blocked)
  else if (sound === 'crack') playCrack(blocked + hpDamage)
}

/** Plays block SFX on trail arrival if backup has not already fired (e.g. trail spawn failed). */
export function armProcBlockTrailBackup(
  slot: ProcBlockAudioSlot,
  kind: ProcBlockSfxKind,
  blocked: number,
  hpDamage: number,
  playThump: (amount: number) => void,
  playCrack: (amount: number) => void,
): void {
  cancelProcBlockBackup(slot)
  slot.backupTimer = setTimeout(() => {
    slot.backupTimer = null
    if (slot.claimed) return
    slot.claimed = true
    playProcBlockSfx(kind, blocked, hpDamage, playThump, playCrack)
    slot.sfx = null
  }, PROC_BLOCK_TRAIL_BACKUP_MS)
}

export function scheduleProcBlockTrailSfx(
  slot: ProcBlockAudioSlot,
  kind: ProcBlockSfxKind,
  blocked: number,
  hpDamage: number,
  arrivalMs: number,
  playThump: (amount: number) => void,
  playCrack: (amount: number) => void,
): void {
  scheduleAfterMs(() => {
    if (slot.claimed) return
    slot.claimed = true
    cancelProcBlockBackup(slot)
    playProcBlockSfx(kind, blocked, hpDamage, playThump, playCrack)
  }, arrivalMs)
}
