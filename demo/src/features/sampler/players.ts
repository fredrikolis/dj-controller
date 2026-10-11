// Concern: sampler presses as rekordbox plays them: a pad starts or restarts its slot, SHIFT+pad stops its position, PAGE steps the bank | Non-concern: the MIDI, the audio | IO: (state, press) -> state
import { BANKS, POSITIONS, slotAt } from '../../shared/sampler/banks.ts'
import type { SamplerState } from '../../shared/sampler/sampler-state.ts'

const replacedAt = (s: SamplerState, position: number, id: number | null): SamplerState => ({ ...s, voices: s.voices.map((v, i) => (i === position ? (id === null ? null : { id, bank: s.bank, position }) : v)) })

// MAN p.84 steps 4-5; RB p.195. ASSUMPTION: empty, nothing.
export function pressed(s: SamplerState, position: number, id: number): SamplerState {
  if (slotAt(s.bank, position) === null) return s
  if (s.voices.some((v) => v?.id === id)) throw new Error(`sampler voice ${id} already plays; each press takes a new id`)
  return replacedAt(s, position, id)
}

// MAN p.84 step 6. ASSUMPTION: any bank's; silent, nothing (no browser to load from, MAN p.83).
export function stopped(s: SamplerState, position: number): SamplerState {
  if (!Number.isInteger(position) || position < 0 || position >= POSITIONS) throw new RangeError(`no sampler position ${position}: there are 0 to ${POSITIONS - 1}`)
  return s.voices[position] ? replacedAt(s, position, null) : s
}

// MAN p.83 step 2. ASSUMPTION: no wrap.
export function paged(s: SamplerState, direction: -1 | 1): SamplerState {
  const bank = Math.min(BANKS - 1, Math.max(0, s.bank + direction))
  return bank === s.bank ? s : { ...s, bank }
}

export function banked(s: SamplerState, bank: number): SamplerState {
  if (!Number.isInteger(bank) || bank < 0 || bank >= BANKS) throw new RangeError(`no sampler bank ${bank}: there are 0 to ${BANKS - 1} (RB p.194)`)
  return bank === s.bank ? s : { ...s, bank }
}

export const playingAt = (s: SamplerState, position: number): boolean => s.voices[position]?.bank === s.bank

export const elsewhereAt = (s: SamplerState, position: number): boolean => (s.voices[position]?.bank ?? s.bank) !== s.bank
