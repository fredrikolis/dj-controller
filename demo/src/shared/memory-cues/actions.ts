// Concern: memory cue presses on one deck, from page or controller, at the press's time; a MEMORY past the limit refused and logged | Non-concern: the rules (memory-cue.ts) | IO: (deck, time) -> state
import type { DeckState } from '../transport/deck-state.ts'
import type { Deck } from '../transport/deck.ts'
import type { LoopPoints } from '../transport/loop-state.ts'
import { logger } from '../logger.ts'
import { engaged, MemoryCuesFull, pressActiveLoop, pressCall, pressDelete, pressMemory, type Direction, type Step } from './memory-cue.ts'

// Seek first: the player jumps before it pauses or loops.
function apply(deck: Deck, { deck: next, seek }: Step<DeckState>): void {
  if (seek !== null) deck.seek(seek)
  deck.update({ playing: next.playing, previewing: next.previewing, cue: next.cue, loop: next.loop, memoryCues: next.memoryCues })
}

export function memory(deck: Deck): void {
  try {
    apply(deck, pressMemory(deck.state.state))
  } catch (err) {
    if (!(err instanceof MemoryCuesFull)) throw err
    logger.error(`MEMORY on the deck playing "${deck.song.title}" was refused`, err)
  }
}

export const call = (deck: Deck, direction: Direction, time: number): void => apply(deck, pressCall(deck.state.state, direction, deck.positionAt(time)))

export const deleteCalled = (deck: Deck): void => apply(deck, pressDelete(deck.state.state))

export const activeLoop = (deck: Deck, time: number): void => apply(deck, pressActiveLoop(deck.state.state, deck.positionAt(time)))

export const engage = (deck: Deck, loop: LoopPoints): void => apply(deck, { deck: engaged(deck.state.state, loop), seek: null })
