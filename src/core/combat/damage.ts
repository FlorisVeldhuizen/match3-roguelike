// How an incoming damage hit splits across block and HP. Both the player-
// attack path (in the store's swap walker) and the enemy-attack path (in
// executeEnemyTurn) call into this so block-absorption / kill-detection
// behave identically.

export type DamageResult = {
  blockAfter: number
  hpAfter: number
  // Clamped at remaining HP — never > hpBefore.
  hpDamage: number
  blocked: number
  blockBroken: boolean
  blockAbsorbed: boolean
  killed: boolean
}

export function applyDamage(
  block: number,
  hp: number,
  incoming: number,
): DamageResult {
  const blocked = Math.min(block, incoming)
  const blockAfter = block - blocked
  const hpDamage = Math.min(hp, incoming - blocked)
  const hpAfter = hp - hpDamage
  return {
    blockAfter,
    hpAfter,
    hpDamage,
    blocked,
    blockBroken: block > 0 && blockAfter === 0,
    blockAbsorbed: blocked > 0 && hpDamage === 0,
    killed: hp > 0 && hpAfter === 0,
  }
}
