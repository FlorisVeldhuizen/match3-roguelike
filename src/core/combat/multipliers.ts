// Cascade-level scoring multipliers. Default is a single identity entry so a
// pristine engine never multiplies. content/cascade.ts registers the real
// table at bootstrap (see architecture §1: "cascade multiplier table is
// content, not a constant" — a future rare relic can swap it).
let multipliers: readonly number[] = [1]

export function setCascadeMultipliers(table: readonly number[]): void {
  if (table.length === 0) throw new Error('cascade multipliers: empty table')
  multipliers = [...table]
}

export function getCascadeMultiplier(level: number): number {
  if (level < 0) return multipliers[0] ?? 1
  const idx = Math.min(level, multipliers.length - 1)
  return multipliers[idx] ?? 1
}
