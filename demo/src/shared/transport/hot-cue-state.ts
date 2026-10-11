// Concern: a song's hot cues as plain state: 16 slots A to P, each empty, a cue point or a hot loop | Non-concern: the hot cue rules (shared/hot-cues) | IO: none
import type { LoopPoints } from './loop-state.ts'

/** In frames of the loaded song. */
export type HotCue = { readonly kind: 'cue'; readonly at: number } | ({ readonly kind: 'loop' } & LoopPoints)

/** Slot A at 0 to P at 15; null is empty. */
export type HotCues = readonly (HotCue | null)[]

// MAN p.78: A-H on page 1, I-P on page 2; RB p.164: up to 16 a track.
export const SLOTS = 16

export const NO_HOT_CUES: HotCues = Array.from({ length: SLOTS }, () => null)

export const slotName = (slot: number): string => String.fromCharCode(65 + slot)
