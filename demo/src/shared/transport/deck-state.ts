// Concern: one deck as plain state: transport, vinyl, TEMPO, cue, key, quantize, loop, cues, what a load keeps | Non-concern: applying it (deck.ts) | IO: none
import type { HotCues } from './hot-cue-state.ts'
import { NO_LOOP, type Loop } from './loop-state.ts'
import type { MemoryCues } from './memory-cue-state.ts'
import type { TempoRange } from './tempo.ts'

export type Lock = { readonly bpm: number; readonly semitones: number }

export type DeckState = {
  readonly loaded: boolean
  readonly playing: boolean
  readonly reverse: boolean
  /** The platter held: only a jog moves the playhead. */
  readonly touched: boolean
  /** MAN p.20. */
  readonly vinyl: boolean
  readonly tempo: number
  readonly tempoRange: TempoRange
  /** In song frames. */
  readonly cue: number
  readonly previewing: boolean
  readonly masterTempo: boolean
  readonly keyShift: number
  readonly keySync: boolean
  readonly locked: Lock | null
  readonly quantize: boolean
  readonly loop: Loop
  readonly hotCues: HotCues
  readonly memoryCues: MemoryCues
}

// ASSUMPTION: cues kept for the page session.
export const loadedState = (s: DeckState): DeckState => ({ ...s, loaded: true, loop: NO_LOOP })
