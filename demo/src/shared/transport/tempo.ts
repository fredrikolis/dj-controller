// Concern: what a TEMPO fader position from 0 to 1 means in each FLX10 range: the playback rate, higher faster; the ranges | Non-concern: key lock, the fader's hardware | IO: (position, range) -> rate
// MAN p.17 item 12: SHIFT+TEMPO RESET steps ±6%, ±10%, ±16%, WIDE and back. ASSUMPTION: WIDE is ±100%, unstated there; MML p.7's playing speed spans ±100.0%.
export const TEMPO_RANGES = [0.06, 0.1, 0.16, 1] as const

export type TempoRange = (typeof TEMPO_RANGES)[number]

// ASSUMPTION: rekordbox's default; the manual states none.
export const FIRST_RANGE: TempoRange = 0.1

export const nextRange = (range: TempoRange): TempoRange => TEMPO_RANGES[(TEMPO_RANGES.indexOf(range) + 1) % TEMPO_RANGES.length]

export const rangeText = (range: TempoRange): string => (range === 1 ? 'WIDE' : `±${Math.round(range * 100)}%`)

/** Higher plays faster, as the FLX10's slider rises toward the player (docs/research/flx10-observed-tempo.md); 1 at the centre. */
export const rateOf = (tempo: number, range: TempoRange): number => 1 + range * (2 * tempo - 1)

export const tempoOf = (rate: number, range: TempoRange): number => Math.min(1, Math.max(0, ((rate - 1) / range + 1) / 2))
