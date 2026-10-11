// Concern: a fader start move applied to its deck, from page or controller | Non-concern: the rules (fader-start.ts) | IO: (deck, move) -> seek, state
import type { Deck } from '../../shared/transport/deck.ts'
import { faderStart, type Move } from './fader-start.ts'

/** The seek first, so the player jumps before it is told to play or stop. */
export function start(deck: Deck, move: Move): void {
  const { deck: next, seek } = faderStart(deck.state.state, move)
  if (seek !== null) deck.seek(seek)
  deck.update({ playing: next.playing, previewing: next.previewing })
}
