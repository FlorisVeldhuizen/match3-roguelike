import type { MapNode } from '../../types'
import { nextInt, type RngState } from '../rng/mulberry32'

// Per-tier gold drop ranges (Phase I tuning). Sat-pegged on the low end
// for early columns so an 8-12 fight run yields enough to engage with the
// first shop without trivialising late shops. Elite is the splashy beat —
// 2-3× a regular col-2 fight, payoff for taking the harder path.
const GOLD_DROP_RANGES: Record<string, { min: number; max: number }> = {
  'fight-col0': { min: 10, max: 15 },
  'fight-col1': { min: 10, max: 15 },
  'fight-col2': { min: 15, max: 20 },
  'fight-col3': { min: 20, max: 25 },
  elite: { min: 35, max: 50 },
  boss: { min: 0, max: 0 },
}

// Roll the gold drop for clearing the given map node. Deterministic from
// the passed rng — caller must thread the returned rng back into
// GameState.rng.loot so reward + gold come from the same stream.
//
// Shop / rest nodes never reach the victory roller (they auto-complete
// without combat), but the function tolerates them by returning 0 gold
// so a future "shop-after-fight" composition wouldn't crash.
export function rollGoldDrop(
  node: MapNode,
  rng: RngState,
): { gold: number; rng: RngState } {
  const key = keyFor(node)
  const range = GOLD_DROP_RANGES[key]
  if (!range || range.max === 0) return { gold: range?.min ?? 0, rng }
  const span = range.max - range.min + 1
  const [n, advanced] = nextInt(rng, span)
  return { gold: range.min + n, rng: advanced }
}

function keyFor(node: MapNode): string {
  if (node.kind === 'boss') return 'boss'
  if (node.kind === 'elite') return 'elite'
  if (node.kind === 'fight') {
    // Cols 0/1 share one band; 2 and 3 each have their own. Default to
    // the col-0 band for any out-of-range column (would only fire if the
    // map gen grew a 4th fight column without a new band — defensive).
    if (node.column <= 1) return 'fight-col0'
    if (node.column === 2) return 'fight-col2'
    return 'fight-col3'
  }
  return 'shop-rest'
}
