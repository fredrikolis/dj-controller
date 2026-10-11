// Concern: taps timed into a BPM, as rekordbox's TAP buttons take them: the last intervals averaged, a long gap starting again | Non-concern: what the BPM sets | IO: (taps, time) -> BPM
export type Taps = readonly number[]

// MAN p.16 item 6, p.55 item 4, their rule unstated. ASSUMPTION: a tap over 2 s after the last starts again; the BPM is the mean of the last 4 intervals.
const GAP_MS = 2000
const INTERVALS = 4

export function tapped(taps: Taps, time: number): Taps {
  const last = taps.at(-1)
  return last === undefined || time - last > GAP_MS ? [time] : [...taps, time].slice(-INTERVALS - 1)
}

export function tappedBpm(taps: Taps): number | null {
  const first = taps[0]
  const last = taps.at(-1)
  return first === undefined || last === undefined || last === first ? null : (60000 * (taps.length - 1)) / (last - first)
}
