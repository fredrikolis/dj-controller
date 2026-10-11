// Concern: PLAY, CUE, SLIP REVERSE and SHIFT+TEMPO RESET pressed and let go on one deck, from page or controller, applied to it | Non-concern: the rules | IO: (deck) -> seek, state
import type { Deck } from '../../shared/transport/deck.ts'
import type { DeckState } from '../../shared/transport/deck-state.ts'
import { gridOf } from '../../shared/transport/grid.ts'
import { nextRange } from '../../shared/transport/tempo.ts'
import { pressCue, pressPlay, pressReverse, releaseCue, type Step } from './cdj.ts'

// The seek first, so the player jumps before it is told to play or stop.
function apply(deck: Deck, { deck: next, seek }: Step<DeckState>): void {
  if (seek !== null) deck.seek(seek)
  deck.update({ playing: next.playing, cue: next.cue, previewing: next.previewing })
}

export const play = (deck: Deck, shift: boolean): void => apply(deck, pressPlay(deck.state.state, shift))

export const cueDown = (deck: Deck, shift: boolean): void => apply(deck, pressCue(deck.state.state, shift, deck.position, gridOf(deck)))

export const cueUp = (deck: Deck): void => apply(deck, releaseCue(deck.state.state))

export const reverse = (deck: Deck, shift: boolean): void => deck.update({ reverse: pressReverse(deck.state.state, shift).reverse })
export const stepRange = (deck: Deck): void => deck.update({ tempoRange: nextRange(deck.state.state.tempoRange) })
