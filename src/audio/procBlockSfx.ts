export type ProcBlockSfxKind = 'absorbed' | 'broken' | null

/** Shield SFX for status-proc block trails when block-* events may be missing. */
export function resolvePlayerProcBlockSound(
  kind: ProcBlockSfxKind,
  blocked: number,
  hpDamage: number,
): 'thump' | 'crack' | null {
  if (kind === 'absorbed') return blocked > 0 ? 'thump' : null
  if (kind === 'broken') return blocked + hpDamage > 0 ? 'crack' : null
  if (blocked <= 0) return null
  return hpDamage > 0 ? 'crack' : 'thump'
}

export function playPlayerProcBlockSfx(
  kind: ProcBlockSfxKind,
  blocked: number,
  hpDamage: number,
  playThump: (amount: number) => void,
  playCrack: (amount: number) => void,
): void {
  const sound = resolvePlayerProcBlockSound(kind, blocked, hpDamage)
  if (sound === 'thump') playThump(blocked)
  else if (sound === 'crack') playCrack(blocked + hpDamage)
}
