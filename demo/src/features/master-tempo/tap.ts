// Concern: TAP, SHIFT+QUANTIZE as rekordbox plays it on a DDJ-FLX10: the TEMPO position playing the taps' BPM | Non-concern: the taps (shared/tap.ts), the buttons | IO: (BPM) -> position
import type { DeckState } from '../../shared/transport/deck-state.ts'
import { tempoOf } from '../../shared/transport/tempo.ts'

// MAN p.16 item 6. ASSUMPTION: a BPM past the range's end moves the fader to that end.
export const tempoFor = (deck: Pick<DeckState, 'tempoRange'>, bpm: number, songBpm: number): number => tempoOf(bpm / songBpm, deck.tempoRange)
