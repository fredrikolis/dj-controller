// Concern: sampler presses as rekordbox plays them: a pad starts its slot afresh, SHIFT+pad stops it, PAGE steps the bank | Non-concern: MIDI, audio | IO: (state, press) -> state
import { BANKS, slotAt } from '../../shared/sampler/banks.ts'
import type { SamplerState } from '../../shared/sampler/sampler-state.ts'

const replacedAt = (s: SamplerState, position: number, id: number | null): SamplerState => ({ ...s, voices: s.voices.map((v, i) => (i === position ? (id === null ? null : { id, bank: s.bank, position }) : v)) })

// MAN p.84 steps 4-5; RB p.195. ASSUMPTION: empty, nothing.
export function pressed(s: SamplerState, position: number, id: number): SamplerState {
  if (slotAt(s.bank, position) === null) return s
  return replacedAt(s, position, id)
}

// MAN p.84 step 6. ASSUMPTION: any bank's.
export function stopped(s: SamplerState, position: number): SamplerState {
  return s.voices[position] ? replacedAt(s, position, null) : s
}

// MAN p.83 step 2.
export function paged(s: SamplerState, direction: -1 | 1): SamplerState {
  const bank = Math.min(BANKS - 1, Math.max(0, s.bank + direction))
  return bank === s.bank ? s : { ...s, bank }
}

export const playingAt = (s: SamplerState, position: number): boolean => s.voices[position]?.bank === s.bank

export const elsewhereAt = (s: SamplerState, position: number): boolean => (s.voices[position]?.bank ?? s.bank) !== s.bank
