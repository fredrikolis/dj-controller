// Concern: a song's time in bars: a bar's seconds, a loop's frames, a slopbank node timed in bars | Non-concern: which songs, rendering | IO: (bpm, node) -> node
export const BEATS_PER_BAR = 4

export const secsPerBar = (bpm: number): number => (BEATS_PER_BAR * 60) / bpm

export const loopFrames = (bars: number, bpm: number, sampleRate: number): number => Math.round(bars * secsPerBar(bpm) * sampleRate)

const NUMBER = String.raw`\d+(?:\.\d+)?`
const ONSET = new RegExp(String.raw`(@sva[0-9a-f]+\(t - )(${NUMBER})s\b`, 'g')
const LENGTH = new RegExp(String.raw`\blen=(${NUMBER})(?![\w.])`, 'g')
const SUPPORT = new RegExp(String.raw`, 0s, (${NUMBER})s\)\s*$`)

/** Onsets and note lengths in bars, so another tempo moves them; a sound, with no onsets, keeps its pitch and timbre. */
export function barred(node: string, secsPerBar: number): string {
  const bars = (secs: string) => `${Number((Number(secs) / secsPerBar).toFixed(10))}b`
  if (node.match(ONSET) === null) return node
  const timed = node.replace(ONSET, (_, head: string, secs: string) => head + bars(secs)).replace(LENGTH, (_, secs: string) => `len=${bars(secs)}`)
  return timed.replace(SUPPORT, (_, secs: string) => `, 0s, max(${secs}s, ${bars(secs)}))`)
}
