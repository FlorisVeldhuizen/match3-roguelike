import { getArchetype } from '../core/combat/archetypeRegistry'
import type { EnemyArchetype } from '../types'

/** Passive traits shown on hover over the enemy name (not covered by the current intent). */
export function enemyPassiveTraitHint(archetype: EnemyArchetype): string | undefined {
  const def = getArchetype(archetype)
  const lines: string[] = []

  if (def.onHitSelfHeal != null && def.onHitSelfHeal > 0) {
    const pct = Math.round(def.onHitSelfHeal * 100)
    lines.push(`Lifesteal — heals for ${pct}% of damage dealt.`)
  }
  if (def.onHitStatus) {
    const name = def.onHitStatus.kind.charAt(0).toUpperCase() + def.onHitStatus.kind.slice(1)
    lines.push(`On hit — applies ${def.onHitStatus.stacks} ${name} when attacks land.`)
  }
  if (def.enragePattern) {
    const threshold = Math.round((def.enrageThreshold ?? 0.5) * 100)
    lines.push(`Enrage — below ${threshold}% HP, switches to a more aggressive pattern.`)
  }
  if (def.colorDrainDuration != null) {
    lines.push('Color drain — matching a cursed gem colour heals this enemy.')
  }

  if (lines.length === 0) return undefined
  return lines.join(' ')
}
