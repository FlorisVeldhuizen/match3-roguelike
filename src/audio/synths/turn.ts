import { getCtx, isMuted, out } from '../context'
import { jitter } from '../utils'

// --- Turn-start cue ---
// Three-note ascending major triad (A4 → C#5 → E5) on soft mallet-style
// sine partials. Locked in after picker A/B vs doorbell and bell variants.
// The triadic climb does the signaling — volume stays modest. Sits a full
// octave below the cascade chime so it reads as "your turn" rather than
// "cascade resolved".
//
// Tuning history (partial peaks / attack):
//   - initial lock-in: 0.07 / 0.025 / 0.008, 12ms attack
//   - first trim:      0.05 / 0.018 / 0.0055 (~30% cut, mastering pass)
//   - chill pass:      0.038 / 0.013 / 0.003 (~45% further cut on 4× sparkle
//                      partial — that bright top was the alert edge). Attack
//                      stretched 12→22 ms so onset is mallet-soft, not pingy.
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

// --- Enemy-turn cue ---
// Minor third descending in the low register (A3 → F3) on sine partials,
// with a sub-thud (~80 Hz) anchor at the downbeat. The slight detune on
// the upper partial gives a barely-audible beat — dread without horror-
// movie cheese. Locked in after A/B vs stab and dread variants. Inverted
// palette versus the turn-start cue: down + dark + weighted.
//
// Tuning history (mirrors triad — both fire every phase transition):
//   - initial lock-in: 0.09 / 0.025 partials, 0.015 detune, 0.12 sub-thud
//   - first trim:      0.063 / 0.018 / 0.011 / 0.084 (~30% cut)
//   - chill pass:      0.048 / 0.014 / 0.008 / 0.055 (further ~35% on
//                      sub-thud — that low layer was the dominant
//                      perceptual weight). Attack 18→22 ms to match triad.
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
    // Detuned octave — slightly sharp (~+6 cents) so it beats against the
    // clean octave at ~1 Hz, giving a soft pulse.
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
  // Sub-thud anchor: brief ~80 Hz sine pulse at the downbeat for weight.
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

// Extra-turn chime — a 4-note ascending major arpeggio (root → 3rd → 5th →
// octave) in the same music-box voice. Pulled back to match the triad/
// descend chillness pass so all three turn-banner cues sit in the same
// loudness band. The reward character comes from the *arpeggio shape* +
// the sparkle layer, not extra volume. Sits a fourth above the cascade
// chime base (G5 root) so it doesn't collide with the cascade band.
function synthExtraTurn(): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  // G major arpeggio: G5 → B5 → D6 → G6 (1, 5/4, 3/2, 2 ratios from G5=784Hz).
  const baseFreq = 784
  const ARP_RATIOS = [1, 5 / 4, 3 / 2, 2]
  const stagger = 0.075 + (Math.random() - 0.5) * 0.015
  for (let i = 0; i < ARP_RATIOS.length; i++) {
    const ratio = ARP_RATIOS[i]
    if (ratio === undefined) continue
    const t = now + stagger * i
    const isLast = i === ARP_RATIOS.length - 1
    // Last note rings out ~2× longer than mid notes — turns the arpeggio
    // into a clear "landing", not a four-note tap.
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

  // Sparkle layer — 3 high pinged sines scattered across the arpeggio.
  // Always-on here (extra-turn is rare enough that a sparkle each time
  // stays special, not annoying).
  const arpDur = stagger * (ARP_RATIOS.length - 1) + 0.3
  for (let i = 0; i < 3; i++) {
    const t = now + 0.05 + Math.random() * arpDur
    const freq = baseFreq * (3 + Math.random() * 2.5) // 2.4 kHz – 4.4 kHz band
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
