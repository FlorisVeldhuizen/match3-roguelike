// Procedurally generate four placeholder SFX WAVs into public/sfx/.
// Pure Node, no deps. Run with `node scripts/gen-sfx.mjs`.
// These are intentionally short, retro-flavored beeps — drop in real assets
// later by replacing the files in public/sfx/ (same names).
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', 'public', 'sfx')
const SAMPLE_RATE = 44100

function writeWav(filename, samples) {
  const numSamples = samples.length
  const buffer = Buffer.alloc(44 + numSamples * 2)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + numSamples * 2, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20) // PCM
  buffer.writeUInt16LE(1, 22) // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24)
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(numSamples * 2, 40)
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0))
    buffer.writeInt16LE(Math.round(s * 32767), 44 + i * 2)
  }
  mkdirSync(dirname(filename), { recursive: true })
  writeFileSync(filename, buffer)
  console.log('wrote', filename.replace(__dirname + '/..', '.'), `${numSamples} samples`)
}

function adsr(t, total, a, d, sustain, r) {
  if (t < a) return t / a
  if (t < a + d) return 1 - (1 - sustain) * ((t - a) / d)
  if (t < total - r) return sustain
  if (t < total) return sustain * (1 - (t - (total - r)) / r)
  return 0
}

const sine = (freq, t) => Math.sin(2 * Math.PI * freq * t)
const triangle = (freq, t) => {
  const p = (t * freq) % 1
  return p < 0.5 ? 4 * p - 1 : 3 - 4 * p
}
const noise = () => Math.random() * 2 - 1

function genClear() {
  const duration = 0.13
  const total = Math.floor(duration * SAMPLE_RATE)
  const out = new Array(total)
  for (let i = 0; i < total; i++) {
    const t = i / SAMPLE_RATE
    const freq = 760 + 760 * (t / duration)
    const env = adsr(t, duration, 0.004, 0.025, 0.55, 0.08)
    out[i] = 0.32 * env * triangle(freq, t)
  }
  return out
}

function genArpeggio(notes, noteDur, level) {
  const total = Math.floor(notes.length * noteDur * SAMPLE_RATE)
  const out = new Array(total).fill(0)
  for (let n = 0; n < notes.length; n++) {
    const startSample = Math.floor(n * noteDur * SAMPLE_RATE)
    const endSample = Math.floor((n + 1) * noteDur * SAMPLE_RATE)
    const freq = notes[n]
    for (let i = startSample; i < endSample && i < total; i++) {
      const localT = (i - startSample) / SAMPLE_RATE
      const env = adsr(localT, noteDur, 0.005, 0.04, 0.55, 0.05)
      out[i] += level * env * triangle(freq, i / SAMPLE_RATE)
    }
  }
  return out
}

function genCascade() {
  return genArpeggio([523.25, 659.25, 783.99], 0.08, 0.3)
}

function genVictory() {
  return genArpeggio([523.25, 659.25, 783.99, 1046.5], 0.15, 0.34)
}

function genDamage() {
  const duration = 0.2
  const total = Math.floor(duration * SAMPLE_RATE)
  const out = new Array(total)
  for (let i = 0; i < total; i++) {
    const t = i / SAMPLE_RATE
    const env = adsr(t, duration, 0.002, 0.05, 0.35, 0.12)
    // Pitch sweep down (160 → 80 Hz) + noise grit.
    const freq = 160 - 80 * (t / duration)
    const sub = sine(freq, t)
    const ns = noise() * Math.max(0, 1 - t / (duration * 0.6))
    out[i] = 0.5 * env * (sub * 0.7 + ns * 0.35)
  }
  return out
}

writeWav(join(OUT_DIR, 'clear.wav'), genClear())
writeWav(join(OUT_DIR, 'cascade.wav'), genCascade())
writeWav(join(OUT_DIR, 'damage.wav'), genDamage())
writeWav(join(OUT_DIR, 'victory.wav'), genVictory())
