import { getCtx, isMuted, out } from '../context'
import { jitter, makeNoiseBurst } from '../utils'

// Drop-sound cue — fires once per cascade step when columns settle. This
// cue fires a LOT (every cascade resolves at least once, deep chains many
// times) so it's mixed quieter than per-match cues like clack or attack.
// User locked in 'clack' (woody/percussive tap) after an A/B against four
// alternatives — bandpassed noise around 1.4 kHz plus a tiny low body sine
// for weight without committing to a thump.
function synthDropClack(): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const pitchJ = jitter(0.18)
  const velocity = jitter(0.25)

  // The clack: short bandpassed noise burst. Q=4 narrows the band enough
  // to read as a defined "tac" rather than a wash of noise.
  const tacDur = 0.045
  const tac = makeNoiseBurst(c)
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 1400 * pitchJ
  bp.Q.value = 4
  const tg = c.createGain()
  tg.gain.setValueAtTime(0.0001, now)
  tg.gain.exponentialRampToValueAtTime(0.13 * velocity, now + 0.002)
  tg.gain.exponentialRampToValueAtTime(0.0001, now + tacDur)
  tac.connect(bp).connect(tg).connect(out(c))
  tac.start(now)
  tac.stop(now + tacDur + 0.02)

  // Light body: short sine ping at ~200 Hz. Almost subliminal — gives the
  // clack a hint of weight so it doesn't sound like only-treble.
  const body = c.createOscillator()
  body.type = 'sine'
  body.frequency.setValueAtTime(200 * pitchJ, now)
  body.frequency.exponentialRampToValueAtTime(150 * pitchJ, now + 0.04)
  const bg = c.createGain()
  bg.gain.setValueAtTime(0.0001, now)
  bg.gain.exponentialRampToValueAtTime(0.04 * velocity, now + 0.003)
  bg.gain.exponentialRampToValueAtTime(0.0001, now + 0.05)
  body.connect(bg).connect(out(c))
  body.start(now)
  body.stop(now + 0.07)
}

export function playDropSfx(): void {
  if (isMuted()) return
  synthDropClack()
}
