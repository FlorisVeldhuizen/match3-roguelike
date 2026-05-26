import { getCtx, isMuted, out } from '../context'
import { jitter, makeNoiseBurst } from '../utils'

// Brute column-smash impact — replaces the attack-sfx placeholder
// previously used. Heavier than an attack: low-frequency thud + a
// short rubble crackle layered on top so the cue reads as "big
// physical event" without becoming a generic explosion. Pairs with
// the magnitude-1.1 screen-shake fired alongside.
function synthSmash(): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const dur = 0.48

  // Body: low sine dropping 110 → 55 Hz. Carries the weight of the
  // impact; very fast attack, longish decay.
  const body = c.createOscillator()
  body.type = 'sine'
  body.frequency.setValueAtTime(110 * jitter(0.08), now)
  body.frequency.exponentialRampToValueAtTime(55 * jitter(0.08), now + 0.32)
  const bodyGain = c.createGain()
  bodyGain.gain.setValueAtTime(0.0001, now)
  bodyGain.gain.exponentialRampToValueAtTime(0.45, now + 0.012)
  bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + dur)
  body.connect(bodyGain).connect(out(c))
  body.start(now)
  body.stop(now + dur + 0.02)

  // Slight high-mid sub-body for "crack" character — square at 220 Hz,
  // very brief, masked by the rubble layer below.
  const crack = c.createOscillator()
  crack.type = 'square'
  crack.frequency.setValueAtTime(220 * jitter(0.1), now)
  crack.frequency.exponentialRampToValueAtTime(110 * jitter(0.1), now + 0.08)
  const crackGain = c.createGain()
  crackGain.gain.setValueAtTime(0.0001, now)
  crackGain.gain.exponentialRampToValueAtTime(0.18, now + 0.008)
  crackGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12)
  crack.connect(crackGain).connect(out(c))
  crack.start(now)
  crack.stop(now + 0.13)

  // Rubble crackle: highpass noise burst for the falling-debris layer
  // on top of the body. 300ms tail so it lingers past the thud.
  const noise = makeNoiseBurst(c)
  const filter = c.createBiquadFilter()
  filter.type = 'highpass'
  filter.frequency.setValueAtTime(1200, now)
  filter.frequency.exponentialRampToValueAtTime(600, now + 0.3)
  const nGain = c.createGain()
  nGain.gain.setValueAtTime(0.0001, now)
  nGain.gain.exponentialRampToValueAtTime(0.16, now + 0.02)
  nGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3)
  noise.connect(filter).connect(nGain).connect(out(c))
  noise.start(now)
  noise.stop(now + 0.32)
}

export function playSmashSfx(): void {
  if (isMuted()) return
  synthSmash()
}
