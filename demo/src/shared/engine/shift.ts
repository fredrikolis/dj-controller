// Concern: a song rendered some semitones up or down: the BPM and whole sample rate an SVA render takes for it | Non-concern: rendering, which shift is asked | IO: (bpm, semitones, rate) -> (bpm, rate)
/** RB p.171: [-12] to [+12]. */
export const MAX_SEMITONES = 12

export type ShiftedRender = { readonly bpm: number; readonly rate: number }

/** Rendered at BPM/r, sampled at rate/r and played at rate, every sound is r = 2^(k/12) higher at BPM, a bar its frames; the rate whole, as SVA takes it, the BPM fitted to it. */
export function shiftedRender(bpm: number, semitones: number, rate: number): ShiftedRender {
  const sampled = Math.round(rate / 2 ** (semitones / 12))
  return { bpm: (bpm * sampled) / rate, rate: sampled }
}
