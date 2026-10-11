// Concern: a song's memory cues and memory loops as plain state: saved points in song order, at most 10, each loop active or not | Non-concern: the memory cue rules (shared/memory-cues) | IO: none
import type { LoopPoints } from './loop-state.ts'

/** In frames of the loaded song; a memory loop's `active` is rekordbox's Active Loop (MAN p.22, RB p.164). */
export type MemoryCue = { readonly kind: 'cue'; readonly at: number } | ({ readonly kind: 'loop'; readonly active: boolean } & LoopPoints)

/** In song order by `frameOf`. */
export type MemoryCues = readonly MemoryCue[]

// RB p.161, p.163. ASSUMPTION: cues and loops share the one list of 10, as the [MEMORY CUE] panel shows them (RB p.139).
export const MAX_MEMORY_CUES = 10

export const NO_MEMORY_CUES: MemoryCues = []

/** Where a point sits: a cue's frame, a loop's in point. */
export const frameOf = (point: MemoryCue): number => (point.kind === 'cue' ? point.at : point.in)
