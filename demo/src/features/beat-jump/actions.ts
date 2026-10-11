// Concern: beat jumps and searches on one deck, from page or controller, at the press's time or while held | Non-concern: the rules (jump.ts) | IO: (deck, press) -> seek, loop, search
import { until } from '../../shared/streams.ts'
import type { Deck } from '../../shared/transport/deck.ts'
import { gridOf } from '../../shared/transport/grid.ts'
import { jumped, SEARCH_SPEED, type Direction } from './jump.ts'

// The seek first, as every feature's: a loop it exits is set again moved.
export function jump(deck: Deck, beats: number, direction: Direction, time: number): void {
  const { deck: next, seek } = jumped(deck.state.state, deck.positionAt(time), beats, direction, gridOf(deck))
  if (seek === null) return
  deck.seek(seek)
  deck.update({ loop: next.loop })
}

/** Searches until `released` settles or `signal` aborts. */
export async function search(deck: Deck, direction: Direction, released: Promise<unknown>, signal: AbortSignal): Promise<void> {
  if (!deck.state.state.loaded) return
  deck.search(direction * SEARCH_SPEED)
  try {
    await until(released, signal)
  } finally {
    deck.search(0)
  }
}
