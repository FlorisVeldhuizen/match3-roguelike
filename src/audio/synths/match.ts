import { getCtx, isMuted, out } from '../context'
import { jitter, makeNoiseBurst } from '../utils'

// Gentler than damage/heal scaling since clack fires constantly.
function matchIntensity(clusterSize: number): number {
  return 1 + 0.18 * Math.log2(Math.max(1, clusterSize / 3))
}

function renderTwinkleSeq(
  c: AudioContext,
  now: number,
  base: number,
  detune: number,
  ratios: number[],
  stagger: number,
  peak: number,
  decay: number,
  attack: number,
  intensity: number,
): void {
  for (let i = 0; i < ratios.length; i++) {
    const ratio = ratios[i]
    if (ratio === undefined) continue
    const t = now + stagger * i
    const osc = c.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = base * ratio * detune
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(peak * intensity, t + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay)
    osc.connect(g).connect(out(c))
    osc.start(t)
    osc.stop(t + decay + 0.02)
  }
}

// Parked for a future coin/gold/loot cue.
function synthCoinPing(amount: number): void {
  const c = getCtx()
  if (!c) return
  const I = matchIntensity(amount)
  const detune = jitter(0.025)
  const base = 1700 * (1 + (0.06 * (I - 1)) / 0.18)
  const FIFTH = Math.pow(2, 7 / 12)
  renderTwinkleSeq(c, c.currentTime, base, detune, [1, FIFTH, 2], 0.01, 0.035, 0.07, 0.003, I)
}

export function playCoinPingSfx(amount = 1): void {
  if (isMuted()) return
  synthCoinPing(amount)
}

function synthMatchSwell(clusterSize: number): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const I = matchIntensity(clusterSize)
  const dur = 0.135

  const noise = makeNoiseBurst(c)
  const hp = c.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 400
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.Q.value = 1.3
  bp.frequency.setValueAtTime(550 * jitter(0.1), now)
  bp.frequency.exponentialRampToValueAtTime(2800 * jitter(0.1), now + dur)

  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, now)
  g.gain.exponentialRampToValueAtTime(0.18 * I, now + dur * 0.5)
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur)
  noise.connect(hp).connect(bp).connect(g).connect(out(c))
  noise.start(now)
  noise.stop(now + dur + 0.02)
}

export function playClackSfx(clusterSize = 3): void {
  if (isMuted()) return
  synthMatchSwell(clusterSize)
}
