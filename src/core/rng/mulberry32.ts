export type RngState = { seed: number }

export function nextU32(rng: RngState): [number, RngState] {
  let t = (rng.seed + 0x6d2b79f5) >>> 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  const u32 = (t ^ (t >>> 14)) >>> 0
  return [u32, { seed: u32 }]
}

export function next(rng: RngState): [number, RngState] {
  const [u32, nextRng] = nextU32(rng)
  return [u32 / 0x100000000, nextRng]
}

export function nextInt(
  rng: RngState,
  maxExclusive: number,
): [number, RngState] {
  if (maxExclusive <= 0) throw new Error('nextInt: maxExclusive must be > 0')
  const [r, n] = next(rng)
  return [Math.floor(r * maxExclusive), n]
}

export function pick<T>(rng: RngState, arr: readonly T[]): [T, RngState] {
  if (arr.length === 0) throw new Error('pick: empty array')
  const [idx, n] = nextInt(rng, arr.length)
  const v = arr[idx]
  if (v === undefined) throw new Error('pick: out-of-bounds')
  return [v, n]
}

export function shuffle<T>(rng: RngState, arr: readonly T[]): [T[], RngState] {
  const out = arr.slice()
  let r = rng
  for (let i = out.length - 1; i > 0; i--) {
    const [j, nr] = nextInt(r, i + 1)
    r = nr
    const ai = out[i]
    const aj = out[j]
    if (ai === undefined || aj === undefined) throw new Error('shuffle: oob')
    out[i] = aj
    out[j] = ai
  }
  return [out, r]
}
