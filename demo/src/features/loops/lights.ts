// Concern: what a deck's loop state lights: QUANTIZE, LOOP IN/OUT steady or blinking, EXIT, RELOOP, the active pad; the patterns | Non-concern: writing them (shared/lights) | IO: (deck) -> lights
import type { Pattern } from 'dj-controller'
import type { Grid } from '../../shared/transport/grid.ts'
import { beatsOf, type Looping } from './loop.ts'

export type Light = 'off' | 'on' | 'blink' | 'fast'

export type Lights = { readonly quantize: boolean; readonly loopIn: Light; readonly loopOut: Light; readonly exit: boolean; readonly reloop: boolean; readonly beats: number | null }

// ASSUMPTION
const HALF_MS = 250
export const BLINK: Pattern<boolean> = { steps: [[true, HALF_MS], [false, HALF_MS]], repeat: true }
export const FAST: Pattern<boolean> = { steps: [[true, HALF_MS / 2], [false, HALF_MS / 2]], repeat: true }

// flx10-connect.md frames 294-321; ASSUMPTION: to 127.
export const PAD_COLOUR = 0x6a
export const PAD_BLINK: Pattern<number> = { steps: [[PAD_COLOUR, HALF_MS], [127, HALF_MS]], repeat: true }

const point = (deck: Looping, which: 'in' | 'out'): Light => (deck.loop.adjust === which ? 'fast' : 'blink')

// Frames 141-155. ASSUMPTION: blinks, EXIT, RELOOP.
export function lightsOf(deck: Looping, grid: Grid): Lights {
  const { stored, active, pending } = deck.loop
  if (active && stored) return { quantize: deck.quantize, loopIn: point(deck, 'in'), loopOut: point(deck, 'out'), exit: true, reloop: false, beats: beatsOf(stored, grid) }
  const lit: Light = deck.loaded ? 'on' : 'off'
  return { quantize: deck.quantize, loopIn: deck.loaded && pending !== null ? 'blink' : lit, loopOut: lit, exit: false, reloop: deck.loaded && stored !== null, beats: null }
}
