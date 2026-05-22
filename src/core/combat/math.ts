// Global rule (architecture §1): all fractional pool/damage outputs floor to
// integer at the moment they land. Every value-modifying caller routes through
// this helper so the rule is decided once.
export function applyMultiplier(amount: number, mult: number): number {
  return Math.floor(amount * mult)
}
