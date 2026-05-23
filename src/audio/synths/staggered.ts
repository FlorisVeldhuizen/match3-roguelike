import { getCtx, isMuted, out } from '../context'
import { jitter } from '../utils'

// Staggered — the enemy's shield broke and they're dazed, skipping their
// turn. Three descending sine notes, each bending slightly downward, give
// a "stumble / off-balance" feel. Same music-box sine voice as turn-start
// and extra-turn so it reads as part of the same family, but the descent
// inverts the "triumphant" character — this is the *enemy* reeling, not
// the player being rewarded directly. Lands shortly after the shield-crack
// SFX (which fired on player attack) so it shouldn't double up on impact.
function synthStaggered(): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  // Minor-flavored descent (roughly E5 → C#5 → A4). Pitch jitter per call
  // so chained stagger events on multi-enemy boards don't sample-loop.
  const detune = jitter(0.03)
  const FREQS = [660, 555, 440]
  const gap = 0.085 + (Math.random() - 0.5) * 0.012
  for (let i = 0; i < FREQS.length; i++) {
    const freq = FREQS[i]
    if (freq === undefined) continue
    const t = now + gap * i
    // Each note bends down ~6% over its decay — the "wobble" of a dazed
    // enemy. Subtle, but enough that the cue doesn't read as pure-tone.
    const decay = 0.22
    const partials: [number, number][] = [
      [1.0, 0.09],
      [2.0, 0.022],
    ]
    const attack = 0.02 * jitter(0.25)
    for (const [ratio, peak] of partials) {
      const osc = c.createOscillator()
      osc.type = 'sine'
      const startF = freq * ratio * detune
      osc.frequency.setValueAtTime(startF, t)
      osc.frequency.exponentialRampToValueAtTime(startF * 0.94, t + decay)
      const g = c.createGain()
      const peakJ = peak * jitter(0.2)
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(peakJ, t + attack)
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay)
      osc.connect(g).connect(out(c))
      osc.start(t)
      osc.stop(t + decay + 0.02)
    }
  }
}

export function playStaggeredSfx(): void {
  if (isMuted()) return
  synthStaggered()
}
