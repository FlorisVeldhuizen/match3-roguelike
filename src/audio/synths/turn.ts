import { getCtx, isMuted, out } from '../context'
import { jitter } from '../utils'

function synthTurnStartTriad(): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const baseFreq = 440 // A4
  const RATIOS = [1.0, 5 / 4, 3 / 2]
  const stagger = 0.065 + (Math.random() - 0.5) * 0.01
  for (let i = 0; i < RATIOS.length; i++) {
    const ratio = RATIOS[i]
    if (ratio === undefined) continue
    const t = now + stagger * i
    const isLast = i === RATIOS.length - 1
    const decayMul = isLast ? 1.6 : 1.0
    const partials: [number, number, number][] = [
      [1.0, 0.038, 380 * decayMul],
      [2.0, 0.013, 220 * decayMul],
      [4.0, 0.003, 110 * decayMul],
    ]
    const attackTime = 0.022 * jitter(0.22)
    for (const [pRatio, peak, decay] of partials) {
      const osc = c.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = baseFreq * ratio * pRatio
      const peakJ = peak * jitter(0.18)
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
}

export function playTurnStartSfx(): void {
  if (isMuted()) return
  synthTurnStartTriad()
}

function synthEnemyTurnDescend(): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const gap = 0.1 + (Math.random() - 0.5) * 0.012
  // A3 → F3 (descending minor third).
  const notes: [number, number][] = [
    [220, 0],
    [174.6, gap],
  ]
  for (const [freq, offset] of notes) {
    const partials: [number, number, number][] = [
      [1.0, 0.048, 340],
      [2.0, 0.014, 200],
    ]
    const attackTime = 0.022 * jitter(0.2)
    const t = now + offset
    for (const [ratio, peak, decay] of partials) {
      const osc = c.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = freq * ratio
      const peakJ = peak * jitter(0.15)
      const decayS = (decay / 1000) * jitter(0.12)
      const g = c.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(peakJ, t + attackTime)
      g.gain.exponentialRampToValueAtTime(0.0001, t + decayS)
      osc.connect(g).connect(out(c))
      osc.start(t)
      osc.stop(t + decayS + 0.02)
    }
    // Slightly sharp (~+6 cents) so it beats against the clean octave at ~1 Hz.
    const detune = c.createOscillator()
    detune.type = 'sine'
    detune.frequency.value = freq * 2.0 * 1.00347
    const dg = c.createGain()
    dg.gain.setValueAtTime(0.0001, t)
    dg.gain.exponentialRampToValueAtTime(0.008, t + 0.022)
    dg.gain.exponentialRampToValueAtTime(0.0001, t + 0.22)
    detune.connect(dg).connect(out(c))
    detune.start(t)
    detune.stop(t + 0.24)
  }
  const sub = c.createOscillator()
  sub.type = 'sine'
  sub.frequency.setValueAtTime(95 * jitter(0.08), now)
  sub.frequency.exponentialRampToValueAtTime(60, now + 0.14)
  const sg = c.createGain()
  sg.gain.setValueAtTime(0.0001, now)
  sg.gain.exponentialRampToValueAtTime(0.055 * jitter(0.18), now + 0.006)
  sg.gain.exponentialRampToValueAtTime(0.0001, now + 0.16)
  sub.connect(sg).connect(out(c))
  sub.start(now)
  sub.stop(now + 0.18)
}

export function playEnemyTurnSfx(): void {
  if (isMuted()) return
  synthEnemyTurnDescend()
}

function synthExtraTurn(): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  // G major arpeggio: G5 → B5 → D6 → G6.
  const baseFreq = 784
  const ARP_RATIOS = [1, 5 / 4, 3 / 2, 2]
  const stagger = 0.075 + (Math.random() - 0.5) * 0.015
  for (let i = 0; i < ARP_RATIOS.length; i++) {
    const ratio = ARP_RATIOS[i]
    if (ratio === undefined) continue
    const t = now + stagger * i
    const isLast = i === ARP_RATIOS.length - 1
    const decayMul = isLast ? 2.0 : 1.0
    const partials: [number, number, number][] = [
      [1.0, 0.055, 480 * decayMul],
      [2.0, 0.019, 280 * decayMul],
      [4.0, 0.004, 150 * decayMul],
    ]
    const attackTime = 0.022 * jitter(0.22)
    for (const [pRatio, peak, decay] of partials) {
      const osc = c.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = baseFreq * ratio * pRatio
      const peakJ = peak * jitter(0.2)
      const decayS = (decay / 1000) * jitter(0.18)
      const g = c.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(peakJ, t + attackTime)
      g.gain.exponentialRampToValueAtTime(0.0001, t + decayS)
      osc.connect(g).connect(out(c))
      osc.start(t)
      osc.stop(t + decayS + 0.02)
    }
  }

  const arpDur = stagger * (ARP_RATIOS.length - 1) + 0.3
  for (let i = 0; i < 3; i++) {
    const t = now + 0.05 + Math.random() * arpDur
    const freq = baseFreq * (3 + Math.random() * 2.5) // 2.4–4.4 kHz band
    if (freq > 5000) continue
    const ping = c.createOscillator()
    ping.type = 'sine'
    ping.frequency.value = freq
    const pg = c.createGain()
    pg.gain.setValueAtTime(0.0001, t)
    pg.gain.exponentialRampToValueAtTime(0.015, t + 0.008)
    pg.gain.exponentialRampToValueAtTime(0.0001, t + 0.18)
    ping.connect(pg).connect(out(c))
    ping.start(t)
    ping.stop(t + 0.2)
  }
}

export function playExtraTurnSfx(): void {
  if (isMuted()) return
  synthExtraTurn()
}
