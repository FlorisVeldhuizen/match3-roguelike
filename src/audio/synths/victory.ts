import { getCtx, isMuted, out } from '../context'
import { jitter } from '../utils'

// 7-note C-major arpeggio climbing two octaves (~770ms) + sustained C3
// bass + sparkle shower. Final note rings ~2s so the cue lands rather
// than beeps.
function synthVictory(): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  // C5 base, ascending triad doubled across two octaves on pure 5/4/3/2
  // ratios so the climb lands on chord tones.
  const baseFreq = 523.25
  const RATIOS = [1, 5 / 4, 3 / 2, 2, 5 / 2, 3, 4]
  const noteCount = RATIOS.length
  const stagger = 0.11
  for (let i = 0; i < noteCount; i++) {
    const ratio = RATIOS[i]
    if (ratio === undefined) continue
    // First note locks the downbeat; rest humanise with small jitter.
    const staggerJ = i === 0 ? 0 : (Math.random() - 0.5) * 0.025
    const t = now + stagger * i + staggerJ
    const isLast = i === noteCount - 1
    // Final note rings ~3.5× longer — turns the arpeggio into a chord
    // landing instead of a 7-note trill.
    const decayMul = isLast ? 3.6 : 1.0
    const partials: [number, number, number][] = [
      [1.0, 0.1, 600 * decayMul],
      [2.0, 0.04, 360 * decayMul],
      [4.0, 0.014, 180 * decayMul],
    ]
    const attackTime = 0.014 * jitter(0.2)
    for (const [pRatio, peak, decay] of partials) {
      const osc = c.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = baseFreq * ratio * pRatio
      const peakJ = peak * jitter(0.15)
      const decayS = (decay / 1000) * jitter(0.15)
      const g = c.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(peakJ, t + attackTime)
      g.gain.exponentialRampToValueAtTime(0.0001, t + decayS)
      osc.connect(g).connect(out(c))
      osc.start(t)
      osc.stop(t + decayS + 0.02)
    }
  }
  // C3 bass thrum — center of gravity under the arpeggio.
  const arpEnd = now + stagger * (noteCount - 1)
  const bass = c.createOscillator()
  bass.type = 'sine'
  bass.frequency.value = 130.81
  const bg = c.createGain()
  bg.gain.setValueAtTime(0.0001, now)
  bg.gain.exponentialRampToValueAtTime(0.09, now + 0.1)
  bg.gain.setValueAtTime(0.09, arpEnd)
  bg.gain.exponentialRampToValueAtTime(0.0001, arpEnd + 1.5)
  bass.connect(bg).connect(out(c))
  bass.start(now)
  bass.stop(arpEnd + 1.6)
  // 8 high pings scattered through the arpeggio for shimmer.
  const arpDur = stagger * (noteCount - 1) + 1.0
  for (let i = 0; i < 8; i++) {
    const t = now + 0.08 + Math.random() * arpDur
    const freq = baseFreq * (4 + Math.random() * 3)
    if (freq > 5500) continue
    const ping = c.createOscillator()
    ping.type = 'sine'
    ping.frequency.value = freq
    const pg = c.createGain()
    pg.gain.setValueAtTime(0.0001, t)
    pg.gain.exponentialRampToValueAtTime(0.025, t + 0.008)
    pg.gain.exponentialRampToValueAtTime(0.0001, t + 0.2)
    ping.connect(pg).connect(out(c))
    ping.start(t)
    ping.stop(t + 0.22)
  }
}

export function playVictorySfx(): void {
  if (isMuted()) return
  synthVictory()
}
