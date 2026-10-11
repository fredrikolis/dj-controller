// Concern: the effect maths both threads share: beats, balance, TRANS, rolls, brakes, spins, stretch, jet, Shepard tones, crushing, the clock | Non-concern: the nodes | IO: (time, beats) -> numbers
import type { BufferEffect, Wave } from './messages.ts'

export const beatSeconds = (bpm: number): number => {
  if (!(bpm > 0)) throw new RangeError(`a beat needs a BPM above 0, not ${bpm}`)
  return 60 / bpm
}

const depthOf = (depth: number): number => {
  if (!(depth >= 0 && depth <= 1)) throw new RangeError(`LEVEL/DEPTH runs from 0 to 1, not ${depth}`)
  return depth
}

// RB p.183 step 4. ASSUMPTION: a DJM's curve.
export const balanceOf = (depth: number): { readonly dry: number; readonly wet: number } => ({ dry: Math.min(1, 2 * (1 - depthOf(depth))), wet: Math.min(1, 2 * depthOf(depth)) })

// ASSUMPTION: TRANS open half a cycle (MAN p.95), spins 3x, CRUSH 4 bits held 6 (p.100).
export const transOpen = (beat: number, beats: number, open = 0.5): boolean => (((beat / beats) % 1) + 1) % 1 < open

// MAN p.95. ASSUMPTION: deeper to the middle, longer past it.
export const transCutOf = (depth: number): { readonly cut: number; readonly open: number } => (depthOf(depth) <= 0.5 ? { cut: 2 * depth, open: 0.5 } : { cut: 1, open: 0.5 - (depth - 0.5) / 2 })

export function rollOffset(elapsed: number, length: number, reverse: boolean): number {
  if (elapsed < length) return elapsed
  const at = elapsed % length
  return reverse ? length - 1 - at : at
}

export const brakeOffset = (elapsed: number, duration: number): number => {
  const t = Math.min(elapsed, duration)
  return t - (t * t) / (2 * duration)
}

export const SPIN_SPEED = 3

export const spinOffset = (elapsed: number, duration: number): number => {
  const left = 1 - Math.min(elapsed, duration) / duration
  return (-SPIN_SPEED * duration * (1 - left * left * left)) / 3
}

// MAN p.96 SLIP ROLL records again, p.97 ROLL does not.
export const keepsStart = (was: { readonly mode: BufferEffect | null; readonly frames: number }, mode: BufferEffect | null, frames: number): boolean =>
  was.mode === mode && (mode === 'roll' || mode === 'revRoll' || mode === 'stretch' || (mode === 'slipRoll' && was.frames === frames))

// STRETCH, MAN p.96.
export function stretchRead(elapsed: number, start: number, cycle: number, slow: number): number {
  if (start < 0) return elapsed
  const from = Math.floor(start / cycle) * cycle
  return from + (start - from) / slow + (elapsed - start)
}

export const grainStart = (elapsed: number, grain: number, voice: number): number => {
  const shift = (voice * grain) / 2
  return Math.floor((elapsed + shift) / grain) * grain - shift
}

export const grainWeight = (elapsed: number, start: number, grain: number): number => Math.sin((Math.PI * (elapsed - start)) / grain) ** 2

// MAN p.95. ASSUMPTION: its sweep's span.
export const JET_MS = [0.5, 10] as const

const turn = (x: number): number => ((x % 1) + 1) % 1

export const jetMs = (phase: number, voice: number): number => JET_MS[0] + (JET_MS[1] - JET_MS[0]) * (1 - turn(phase + voice / 2))

export const jetWeight = (phase: number, voice: number): number => Math.sin(Math.PI * turn(phase + voice / 2)) ** 2

// MAN pp.97-98. ASSUMPTION: its partials.
export const MOBIUS_PARTIALS = 8
export const MOBIUS_LOW_HZ = 27.5

const span = (octaves: number, k: number): number => turn((k + octaves) / MOBIUS_PARTIALS)

export const mobiusHz = (octaves: number, k: number): number => MOBIUS_LOW_HZ * 2 ** (span(octaves, k) * MOBIUS_PARTIALS)

export const mobiusLevel = (octaves: number, k: number): number => 0.5 - 0.5 * Math.cos(2 * Math.PI * span(octaves, k))

/** The saw's jump smoothed over `step` (polyBLEP). */
export function waveAt(kind: Wave, phase: number, step: number): number {
  if (kind === 'tri') return 4 * Math.abs(phase - 0.5) - 1
  let blep = 0
  if (phase < step) {
    const t = phase / step
    blep = t + t - t * t - 1
  } else if (phase > 1 - step) {
    const t = (phase - 1) / step
    blep = t * t + t + t + 1
  }
  return 2 * phase - 1 - blep
}

export const stopGain = (elapsed: number, duration: number): number => Math.min(1, Math.max(0, (1 - elapsed / duration) * 4))

export const CRUSH_BITS = 4
export const CRUSH_HOLD = 6

export const crushed = (sample: number, bits: number): number => {
  const steps = 2 ** (bits - 1)
  return Math.round(sample * steps) / steps
}

export const slewed = (own: number, told: number): number => (Math.abs(told - own) > 0.25 ? told : own + (told - own) * 0.1)
