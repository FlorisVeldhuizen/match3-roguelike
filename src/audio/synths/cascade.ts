import { getCtx, isMuted, out } from '../context'
import { jitter } from '../utils'

function synthCascadeChime(level: number): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime

  // Pentatonic ascent; caps so high chains don't get harsh.
  const STEPS = [0, 2, 4, 7, 9, 12, 14, 16]
  const step = STEPS[Math.min(level - 1, STEPS.length - 1)] ?? 0
  // E5 base keeps high cascade levels out of the harsh 2–3 kHz band.
  const baseFreq = 660 * Math.pow(2, step / 12)

  // Volume builds from ~45% at level 1 to full by level 4.
  const loudness = Math.min(1, 0.45 + 0.18 * (level - 1))

  // (ratio, peakGain, decayMs)
  const partials: [number, number, number][] = [
    [1.0, 0.075, 460],
    [2.0, 0.025, 260],
    [4.0, 0.008, 140],
  ]
  const attackTime = 0.018 * jitter(0.3)
  for (const [ratio, peak, decay] of partials) {
    const osc = c.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = baseFreq * ratio
    const peakJ = peak * jitter(0.3)
    const decayS = (decay / 1000) * jitter(0.24)
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, now)
    g.gain.exponentialRampToValueAtTime(peakJ * loudness, now + attackTime)
    g.gain.exponentialRampToValueAtTime(0.0001, now + decayS)
    osc.connect(g).connect(out(c))
    osc.start(now)
    osc.stop(now + decayS + 0.02)
  }
}

export function playCascadeChimeSfx(level: number): void {
  if (isMuted()) return
  synthCascadeChime(level)
}

function synthCascadeCelebration(levels: number): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime

  const headStep = Math.min(levels + 2, 12)
  const headFreq = 660 * Math.pow(2, headStep / 12)

  const ARPEGGIO_RATIOS = [
    1.0,
    Math.pow(2, 7 / 12),  // perfect fifth
    2.0,                   // octave
    Math.pow(2, 17 / 12), // octave + perfect fourth
    Math.pow(2, 19 / 12), // octave + fifth
    4.0,                   // two octaves
  ]
  const noteCount = Math.min(ARPEGGIO_RATIOS.length, Math.max(3, levels))

  const stagger = 0.07 + 0.005 * (noteCount - 3)
  const depthScale = Math.min(1, 0.55 + 0.12 * (levels - 3))

  for (let i = 0; i < noteCount; i++) {
    const pitchRatio = ARPEGGIO_RATIOS[i]
    if (pitchRatio === undefined) continue
    const staggerJ = i === 0 ? 0 : (Math.random() - 0.5) * 0.03
    const startT = now + stagger * i + staggerJ
    const isLast = i === noteCount - 1
    const decayMul = isLast ? 1.4 + 0.25 * (noteCount - 3) : 1.0
    const partials: [number, number, number][] = [
      [1.0, 0.075, 540 * decayMul],
      [2.0, 0.025, 300 * decayMul],
      [4.0, 0.008, 160 * decayMul],
    ]
    const attackTime = 0.018 * jitter(0.3)
    for (const [ratio, peak, decay] of partials) {
      const osc = c.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = headFreq * pitchRatio * ratio
      const peakJ = peak * jitter(0.25)
      const decayS = (decay / 1000) * jitter(0.2)
      const g = c.createGain()
      g.gain.setValueAtTime(0.0001, startT)
      g.gain.exponentialRampToValueAtTime(
        peakJ * depthScale,
        startT + attackTime,
      )
      g.gain.exponentialRampToValueAtTime(0.0001, startT + decayS)
      osc.connect(g).connect(out(c))
      osc.start(startT)
      osc.stop(startT + decayS + 0.02)
    }
  }

  if (levels >= 5) {
    const sparkleCount = Math.min(5, levels - 3)
    const arpeggioDur = stagger * (noteCount - 1) + 0.4
    for (let i = 0; i < sparkleCount; i++) {
      const t = now + 0.05 + Math.random() * arpeggioDur
      const freq = headFreq * (4 + Math.random() * 3)
      if (freq > 5200) continue
      const ping = c.createOscillator()
      ping.type = 'sine'
      ping.frequency.value = freq
      const pg = c.createGain()
      pg.gain.setValueAtTime(0.0001, t)
      pg.gain.exponentialRampToValueAtTime(0.022 * depthScale, t + 0.008)
      pg.gain.exponentialRampToValueAtTime(0.0001, t + 0.16)
      ping.connect(pg).connect(out(c))
      ping.start(t)
      ping.stop(t + 0.18)
    }
  }
}

export function playCascadeCelebrationSfx(levels: number): void {
  if (isMuted()) return
  synthCascadeCelebration(levels)
}
