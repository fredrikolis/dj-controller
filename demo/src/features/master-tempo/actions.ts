// Concern: one deck's TAP presses, from page or controller, setting its TEMPO from the taps' BPM | Non-concern: the tap rules (shared/tap.ts, tap.ts) | IO: (deck, time) -> state
import type { Deck } from '../../shared/transport/deck.ts'
import { tapped, tappedBpm, type Taps } from '../../shared/tap.ts'
import { tempoFor } from './tap.ts'

/** A tap at a press's time; the TEMPO set once two taps give a BPM. */
export function tapper(deck: Deck): (time: number) => void {
  let taps: Taps = []
  return (time) => {
    taps = tapped(taps, time)
    const bpm = tappedBpm(taps)
    if (bpm !== null) deck.update({ tempo: tempoFor(deck.state.state, bpm, deck.song.bpm) })
  }
}
