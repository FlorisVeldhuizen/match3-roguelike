import { getCtx, isMuted, out } from '../context'
import { jitter } from '../utils'

// Cascade chime — fires on each chain link (level >= 1). Mellow music-box
// / soft-marimba character: harmonic sine partials (no inharmonic bell
// metalness), gentle attack, no contact click. The base note climbs a
// pentatonic scale per cascade level so a long chain audibly ascends
// rather than repeating.
function synthCascadeChime(level: number): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime

  // Pentatonic ascent in semitones above the base. Caps at the top step
  // so 8+ chains don't drift into harsh territory.
  const STEPS = [0, 2, 4, 7, 9, 12, 14, 16]
  const step = STEPS[Math.min(level - 1, STEPS.length - 1)] ?? 0
  // Base lowered from A5 (880Hz) to E5 (660Hz) so high cascade levels stay
  // out of the 2–3kHz "sensitive ear" band where things start to feel harsh.
  const baseFreq = 660 * Math.pow(2, step / 12)

  // Per-level loudness ramp: level 1 is often the *only* chime (the chain
  // ended right there), so it shouldn't announce itself like a long chain
  // is starting. Volume builds from ~45% at level 1 to full by level 4 —
  // the chain audibly grows as it extends, not just climbs in pitch.
  const loudness = Math.min(1, 0.45 + 0.18 * (level - 1))

  // Harmonic partials (ratio, peakGain, decayMs). Pure 1:2:4 is the music-
  // box / marimba structure — no inharmonicity means no metallic bell
  // edge. The 4× partial sits very quietly on top for a hint of sparkle
  // without harshness; remove it and it'd read as flute.
  const partials: [number, number, number][] = [
    [1.0, 0.075, 460],
    [2.0, 0.025, 260],
    [4.0, 0.008, 140],
  ]
  // Per-call attack jitter — small mallet-strike timing variation so back-to-
  // back chimes feel struck, not retriggered. Pitch stays locked to the scale.
  const attackTime = 0.018 * jitter(0.3)
  for (const [ratio, peak, decay] of partials) {
    const osc = c.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = baseFreq * ratio
    // Per-partial timbre jitter: each partial gets its own ±15% gain and
    // ±12% decay. Independent per partial means the mix between fundamental
    // and overtones shifts each call — same instrument, different "strike".
    const peakJ = peak * jitter(0.3)
    const decayS = (decay / 1000) * jitter(0.24)
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, now)
    // ~18ms attack — soft mallet onset. Slow enough to lose any percussive
    // "click" edge, fast enough not to read as a blown/flute attack.
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

// Celebration flourish after a good chain finishes. Plays a rising
// arpeggio in the same music-box voice as the per-step chime, so it reads
// as the chain "resolving" on a high note instead of a new instrument
// barging in. The arpeggio grows with chain depth: 3-chain = 3 notes,
// 6+ chain = 6 notes climbing two octaves, with the final note ringing
// out longer the longer the chain. Very long chains also get a quiet
// upper-octave sparkle layer.
function synthCascadeCelebration(levels: number): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime

  // Sit a couple of semitones above the last per-step chime so the
  // flourish lands on a "lifted" register rather than repeating the last
  // chime's pitch. Caps so very long chains don't drift above ~2 kHz.
  const headStep = Math.min(levels + 2, 12)
  const headFreq = 660 * Math.pow(2, headStep / 12)

  // Ascending arpeggio steps. Index in is read by `noteCount`, so a 3-chain
  // plays the first 3 notes (root → fifth → octave), 4-chain extends to
  // the 11th (oct + fourth), and so on up to two full octaves at 6+.
  // Ratios are exact semitone powers so each step lands cleanly on the
  // chord tone above the last.
  const ARPEGGIO_RATIOS = [
    1.0, // root
    Math.pow(2, 7 / 12), // perfect fifth
    2.0, // octave
    Math.pow(2, 17 / 12), // octave + perfect fourth (~2.378)
    Math.pow(2, 19 / 12), // octave + fifth (~2.997)
    4.0, // two octaves
  ]
  const noteCount = Math.min(ARPEGGIO_RATIOS.length, Math.max(3, levels))

  // Stagger expands slightly with longer chains so a 6-note flourish
  // doesn't feel rushed. 70ms at 3 notes, 95ms at 6.
  const stagger = 0.07 + 0.005 * (noteCount - 3)

  // Loudness scales with chain depth — a barely-qualifying 3-chain stays
  // modest; deeper chains land with more presence.
  const depthScale = Math.min(1, 0.55 + 0.12 * (levels - 3))

  for (let i = 0; i < noteCount; i++) {
    const pitchRatio = ARPEGGIO_RATIOS[i]
    if (pitchRatio === undefined) continue
    // Stagger micro-jitter: ±15ms wobble around the nominal slot so the
    // arpeggio feels played, not sequenced. Caps tight enough to preserve
    // the ascent's rhythm. First note is not jittered (locks the downbeat).
    const staggerJ = i === 0 ? 0 : (Math.random() - 0.5) * 0.03
    const startT = now + stagger * i + staggerJ
    const isLast = i === noteCount - 1
    // Final note rings out progressively longer the longer the chain.
    // Mid notes stay short so the arpeggio reads as a climb, not a chord.
    const decayMul = isLast ? 1.4 + 0.25 * (noteCount - 3) : 1.0
    const partials: [number, number, number][] = [
      [1.0, 0.075, 540 * decayMul],
      [2.0, 0.025, 300 * decayMul],
      [4.0, 0.008, 160 * decayMul],
    ]
    // Per-note attack jitter — small variation in mallet-strike timing.
    const attackTime = 0.018 * jitter(0.3)
    for (const [ratio, peak, decay] of partials) {
      const osc = c.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = headFreq * pitchRatio * ratio
      // Per-partial timbre jitter — same shift-the-overtone-mix trick used
      // in the per-step chime, so consecutive flourishes don't sound copy-
      // pasted across runs.
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

  // Sparkle layer on long chains (5+): a few high pinged sines scattered
  // through the arpeggio for a "fairy dust" shimmer. Quiet enough to sit
  // on top of the main flourish without overpowering it.
  if (levels >= 5) {
    const sparkleCount = Math.min(5, levels - 3)
    const arpeggioDur = stagger * (noteCount - 1) + 0.4
    for (let i = 0; i < sparkleCount; i++) {
      const t = now + 0.05 + Math.random() * arpeggioDur
      const freq = headFreq * (4 + Math.random() * 3)
      if (freq > 5200) continue // skip if it'd land above the harshness band
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
