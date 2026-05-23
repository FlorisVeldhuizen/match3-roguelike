import { getCtx, isMuted, out } from '../context'
import { jitter, makeNoiseBurst } from '../utils'

// Sweeping whoosh + low rumble for the "board reshuffled" cue. Longer than
// the drop, more atmospheric — signals "something big happened, look up."
function synthShuffle(): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  // Per-call jitter — shuffle is a notable event, so when it fires twice in
  // close succession it really shouldn't sound identical.
  const dur = 0.55 * jitter(0.12)
  const peakFreq = 2200 * jitter(0.16) // sweep apex
  const startFreq = 600 * jitter(0.12)
  const endFreq = 500 * jitter(0.12)
  const apexTime = dur * (0.45 + (Math.random() - 0.5) * 0.1)
  const velocity = jitter(0.2)

  // Filtered noise sweep: bandpass slides upward then back, giving a
  // whooshy "cards shuffling" texture without sounding like a hiss. Pulls
  // from the shared noise pool — shuffle fires only on reshuffle events
  // (rare) but routing through the same pool keeps the allocation path
  // unified.
  const noise = makeNoiseBurst(c)

  const filter = c.createBiquadFilter()
  filter.type = 'bandpass'
  filter.Q.value = 1.4 * jitter(0.2)
  filter.frequency.setValueAtTime(startFreq, now)
  filter.frequency.exponentialRampToValueAtTime(peakFreq, now + apexTime)
  filter.frequency.exponentialRampToValueAtTime(endFreq, now + dur)

  const gain = c.createGain()
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(0.22 * velocity, now + 0.08)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur)

  noise.connect(filter).connect(gain).connect(out(c))
  noise.start(now)
  noise.stop(now + dur + 0.02)
}

export function playShuffleSfx(): void {
  if (isMuted()) return
  synthShuffle()
}
