// Concern: fader start as rekordbox plays it: a channel leaving or reaching zero by fader or crossfader, its deck started or back-cued | Non-concern: applying it | IO: (mix, deck) -> deck, seek
import type { DeckIndex, Pair } from '../../shared/decks.ts'
import type { Assign } from '../../shared/mixer/curves.ts'
import type { DeckState } from '../../shared/transport/deck-state.ts'

export type Faders = { readonly channels: Pair<{ readonly fader: number; readonly assign: Assign }>; readonly crossfader: number }
export type Move = 'leaves-zero' | 'reaches-zero'
export type Starting = Pick<DeckState, 'loaded' | 'playing' | 'previewing' | 'cue'>
export type Step<D extends Starting> = { readonly deck: D; readonly seek: number | null }

const crossed = (was: number, now: number): Move | null => (was === 0 && now > 0 ? 'leaves-zero' : was > 0 && now === 0 ? 'reaches-zero' : null)

// MAN p.91: zero is the far side; THRU has none.
const travel = (crossfader: number, assign: Assign): number | null => (assign === 'a' ? 1 - crossfader : assign === 'b' ? crossfader : null)

export function moveOf(was: Faders, now: Faders, deck: DeckIndex): Move | null {
  const [from, to] = [was.channels[deck], now.channels[deck]]
  const [left, reached] = [travel(was.crossfader, from.assign), travel(now.crossfader, to.assign)]
  return crossed(from.fader, to.fader) ?? (left === null || reached === null ? null : crossed(left, reached))
}

// MAN pp.90-91. ASSUMPTION: playing plays on; paused stays.
export function faderStart<D extends Starting>(deck: D, move: Move): Step<D> {
  if (!deck.loaded || deck.playing === (move === 'leaves-zero')) return { deck, seek: null }
  return { deck: { ...deck, playing: !deck.playing, previewing: false }, seek: deck.cue }
}
