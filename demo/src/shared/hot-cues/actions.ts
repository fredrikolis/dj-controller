// Concern: hot cue pad presses on one deck, from page or controller, applied at the press's time; hot cues from the URL | Non-concern: the rules (hot-cue.ts) | IO: (deck, slot, time) -> seek, state
import type { DeckState } from '../transport/deck-state.ts'
import type { HotCue, HotCues } from '../transport/hot-cue-state.ts'
import type { Deck } from '../transport/deck.ts'
import { gridOf } from '../transport/grid.ts'
import { pressPad, pressShiftPad, type Step } from './hot-cue.ts'

// Seek first: the player jumps before it plays or loops.
function apply(deck: Deck, { deck: next, seek }: Step<DeckState>): void {
  if (seek !== null) deck.seek(seek)
  deck.update({ playing: next.playing, previewing: next.previewing, loop: next.loop, hotCues: next.hotCues })
}

export const pad = (deck: Deck, slot: number, time: number): void => apply(deck, pressPad(deck.state.state, slot, deck.positionAt(time), gridOf(deck)))

export const shiftPad = (deck: Deck, slot: number): void => apply(deck, pressShiftPad(deck.state.state, slot))

const fits = (cue: HotCue, end: number): boolean => (cue.kind === 'cue' ? cue.at : cue.out) <= end

/** Any past the song's end left empty. */
export function startCues(deck: Deck, cues: HotCues): void {
  const { end } = gridOf(deck)
  deck.update({ hotCues: cues.map((cue) => (cue && fits(cue, end) ? cue : null)) })
}
