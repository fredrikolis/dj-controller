// Concern: engages a deck's Active Loop as its playhead reaches it, looked at once a frame | Non-concern: which loop is reached (the rules) | IO: (deck positions) -> loop
import { frames } from '../../shared/frames.ts'
import { engage } from '../../shared/memory-cues/actions.ts'
import { PLAY_SPEED_LIMIT, reached } from '../../shared/memory-cues/memory-cue.ts'
import type { Deck } from '../../shared/transport/deck.ts'

// A frame late at most, the player folding a playhead past the out back in at its phase (playhead.ts setLoop).
export async function keepActiveLoops(deck: Deck, signal: AbortSignal): Promise<void> {
  let at = performance.now()
  let from = deck.positionAt(at)
  for await (const _ of frames(signal)) {
    const now = performance.now()
    const to = deck.positionAt(now)
    const loop = reached(deck.state.state, from, to, ((now - at) / 1000) * deck.sampleRate * PLAY_SPEED_LIMIT)
    if (loop) engage(deck, loop)
    at = now
    from = to
  }
}
