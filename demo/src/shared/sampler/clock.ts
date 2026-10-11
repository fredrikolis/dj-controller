// Concern: the sampler's BPM, a loop's render BPM, rate and quantized start, GAIN and volume as gains | Non-concern: playing, which deck is the master | IO: (sampler, master deck) -> numbers
import { faderGain } from '../mixer/curves.ts'
import type { SamplerState } from './sampler-state.ts'

export type DeckClock = { readonly playing: boolean; readonly bpm: number; readonly beat: number }

// ASSUMPTION: RB pp.196-198 give none; renders as key lock's.
export const BPM_STEP = 1
export const BPM_RANGE = [60, 200] as const
export const RENDER_RANGE = [72, 288] as const
export const GAIN_RANGE = [-12, 12] as const

const clamp = (value: number, [low, high]: readonly [number, number]): number => Math.min(high, Math.max(low, value))

// RB p.198. ASSUMPTION: off under BPM SYNC.
export function steppedBpm(s: SamplerState, direction: -1 | 1): SamplerState {
  if (s.sync) return s
  const bpm = clamp(s.bpm + direction * BPM_STEP, BPM_RANGE)
  return bpm === s.bpm ? s : { ...s, bpm }
}

export const bpmOf = (s: Pick<SamplerState, 'bpm' | 'sync'>, master: DeckClock): number => (s.sync ? master.bpm : s.bpm)

export const renderBpmOf = (bpm: number): number => clamp(bpm, RENDER_RANGE)

export function rateOf(bpm: number, rendered: number): number {
  if (!(rendered > 0)) throw new RangeError(`a loop rendered at ${rendered} BPM has no rate: renders are made from ${RENDER_RANGE[0]} to ${RENDER_RANGE[1]} BPM`)
  return Math.max(0, bpm) / rendered
}

// RB p.195: Q for Loop slots; p.245: at once, the beat kept.
export function loopOffset(s: Pick<SamplerState, 'quantize'>, master: DeckClock, rendered: number): number {
  if (!s.quantize || !master.playing) return 0
  const phase = master.beat - Math.floor(master.beat)
  return (phase * 60) / rendered
}

export const gainOf = (db: number): number => 10 ** (db / 20)

// ASSUMPTION: the faders' law.
export const volumeOf = (position: number): number => faderGain(position)

export const clampedGain = (db: number): number => clamp(db, GAIN_RANGE)
