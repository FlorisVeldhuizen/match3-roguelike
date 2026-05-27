import type { RngState } from './mulberry32'

// cyrb53: 53-bit hash for deriving per-stream seeds.
function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

export type RngStreams = {
  board: RngState
  enemy: RngState
  loot: RngState
  map: RngState
}

const STREAM_NAMES = ['board', 'enemy', 'loot', 'map'] as const

export function forkStreams(rootSeed: string): RngStreams {
  const out: Partial<RngStreams> = {}
  for (const name of STREAM_NAMES) {
    const h = cyrb53(`${rootSeed}:${name}`)
    out[name] = { seed: h >>> 0 || 1 }
  }
  return out as RngStreams
}
