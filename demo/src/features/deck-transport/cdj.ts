// Concern: PLAY and CUE as a CDJ's: play toggles, cue returns, sets the cue point or previews; SHIFT+CUE to the start; SHIFT+SLIP REVERSE | Non-concern: tempo, audio | IO: (deck, press) -> deck, seek
import type { DeckState } from '../../shared/transport/deck-state.ts'
import type { Grid } from '../../shared/transport/grid.ts'

export type Cdj = Pick<DeckState, 'loaded' | 'playing' | 'cue' | 'previewing'>

export type Step<D extends Cdj> = { readonly deck: D; readonly seek: number | null }

// About 1.3 ms at 48 kHz.
const AT_CUE_FRAMES = 64

export const atCue = (deck: Cdj, position: number): boolean => Math.abs(position - deck.cue) < AT_CUE_FRAMES

const stay = <D extends Cdj>(deck: D): Step<D> => ({ deck, seek: null })

// MAN p.19 gives PLAY no SHIFT function.
export function pressPlay<D extends Cdj>(deck: D, shift: boolean): Step<D> {
  if (!deck.loaded || shift) return stay(deck)
  if (deck.previewing) return stay({ ...deck, previewing: false })
  return stay({ ...deck, playing: !deck.playing })
}

// MAN p.19. ASSUMPTION: play state and cue point kept.
export function pressCue<D extends Cdj>(deck: D, shift: boolean, position: number, grid: Grid): Step<D> {
  if (!deck.loaded) return stay(deck)
  if (shift) return { deck, seek: grid.first }
  if (deck.playing) return { deck: { ...deck, playing: false }, seek: deck.cue }
  if (atCue(deck, position)) return stay({ ...deck, playing: true, previewing: true })
  return stay({ ...deck, cue: position })
}

export function releaseCue<D extends Cdj>(deck: D): Step<D> {
  if (!deck.previewing) return stay(deck)
  return { deck: { ...deck, playing: false, previewing: false }, seek: deck.cue }
}

// MAN p.21; plain needs Slip mode.
export const pressReverse = <D extends Pick<DeckState, 'loaded' | 'reverse'>>(deck: D, shift: boolean): D => (deck.loaded && shift ? { ...deck, reverse: !deck.reverse } : deck)
