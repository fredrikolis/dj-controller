// Concern: the sampler deck as plain state: the bank showing, what plays at each position, BPM, SYNC, Q, GAIN, volume | Non-concern: the press rules, applying it (sampler-deck.ts) | IO: none
import { POSITIONS } from './banks.ts'

/** One start of a slot; a restart is a new id. */
export type Voice = { readonly id: number; readonly bank: number; readonly position: number }

export type SamplerState = {
  readonly bank: number
  readonly voices: readonly (Voice | null)[]
  readonly bpm: number
  readonly sync: boolean
  readonly quantize: boolean
  /** dB. */
  readonly gain: number
  /** SAMPLER VOL, 0 to 1. */
  readonly volume: number
}

// ASSUMPTION: the songs' BPM; RB p.198 step 3 turns BPM SYNC on; Q as the decks'. BPM, SYNC, Q and GAIN stay as they start: the FLX10 has no control for them (MAN pp.83-84).
export const SAMPLER_START: SamplerState = { bank: 0, voices: Array.from({ length: POSITIONS }, () => null), bpm: 144, sync: false, quantize: true, gain: 0, volume: 1 }

export function withoutVoice(s: SamplerState, id: number): SamplerState {
  const at = s.voices.findIndex((v) => v?.id === id)
  return at < 0 ? s : { ...s, voices: s.voices.map((v, i) => (i === at ? null : v)) }
}
