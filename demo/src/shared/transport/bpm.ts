// Concern: the BPM a deck plays at: its key-locked render's, else its song's at the TEMPO rate | Non-concern: rendering, the fader's curve (tempo.ts) | IO: (deck, song BPM) -> BPM
import type { DeckState } from './deck-state.ts'
import { rateOf } from './tempo.ts'

export const playingBpm = (s: Pick<DeckState, 'tempo' | 'tempoRange' | 'locked'>, bpm: number): number => s.locked?.bpm ?? bpm * rateOf(s.tempo, s.tempoRange)
