// Concern: loops as rekordbox plays them on a DDJ-FLX10: quantize, LOOP IN/OUT, halve, double, 4 BEAT/EXIT, RELOOP, adjust, beat-loop pads | Non-concern: the wrap, LEDs | IO: (deck, press) -> deck, seek
import type { DeckState } from '../../shared/transport/deck-state.ts'
import { beatPhase, snapped, type Grid } from '../../shared/transport/grid.ts'
import { looping, type Loop, type LoopPoints } from '../../shared/transport/loop-state.ts'

export type Looping = Pick<DeckState, 'loaded' | 'playing' | 'cue' | 'quantize' | 'loop'>

export type Step<D extends Looping> = { readonly deck: D; readonly seek: number | null }

// ASSUMPTION: 1/64 for manual loops.
export const MIN_BEATS = 1 / 64
export const MAX_BEATS = 512
export const AUTO_BEATS = 4
// ASSUMPTION: page 2.
export const PAD_BEATS: readonly (readonly number[])[] = [
  [1 / 64, 1 / 32, 1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2],
  [4, 8, 16, 32, 64, 128, 256, 512],
]
const AT_POINT_FRAMES = 64
const SAME_FRAMES = 1e-6

// ASSUMPTION: play and pause never change.
const stay = <D extends Looping>(deck: D): Step<D> => ({ deck, seek: null })

const looped = <D extends Looping>(deck: D, loop: Partial<Loop>): D => ({ ...deck, loop: { ...deck.loop, ...loop } })

const length = ({ in: start, out }: LoopPoints): number => out - start

export const beatsOf = (loop: LoopPoints, grid: Grid): number => length(loop) / grid.beat

const snap = (deck: Looping, position: number, grid: Grid): number => snapped(deck.quantize, position, grid)

const tooShort = (len: number, grid: Grid): boolean => len < MIN_BEATS * grid.beat - SAME_FRAMES

// ASSUMPTION: clamped to the end.
function made(start: number, beats: number, grid: Grid): LoopPoints | null {
  const loop = { in: start, out: Math.min(start + beats * grid.beat, grid.end) }
  return tooShort(length(loop), grid) ? null : loop
}

const active = <D extends Looping>(deck: D, stored: LoopPoints): D => ({ ...deck, loop: looping(stored) })

const current = (deck: Looping): LoopPoints | null => (deck.loop.active ? deck.loop.stored : null)

export const pressQuantize = <D extends Looping>(deck: D): Step<D> => stay({ ...deck, quantize: !deck.quantize })

// ASSUMPTION: only ends the adjust.
const endAdjust = <D extends Looping>(deck: D): Step<D> | null => (deck.loop.adjust === null ? null : stay(looped(deck, { adjust: null })))

export function pressLoopIn<D extends Looping>(deck: D, position: number, grid: Grid): Step<D> {
  if (!deck.loaded) return stay(deck)
  const ended = endAdjust(deck)
  if (ended) return ended
  const loop = current(deck)
  if (!loop) {
    const start = Math.min(snap(deck, position, grid), grid.end)
    return stay({ ...looped(deck, { pending: start }), cue: start })
  }
  if ((!deck.playing && Math.abs(position - loop.in) < AT_POINT_FRAMES) || tooShort(length(loop) / 2, grid)) return stay(deck)
  // ASSUMPTION: the player folds the playhead in.
  return stay(active(deck, { in: loop.in, out: loop.in + length(loop) / 2 }))
}

// ASSUMPTION: no in or out ≤ in ignored; out on in a beat on; one behind folds the playhead in.
export function pressLoopOut<D extends Looping>(deck: D, position: number, grid: Grid): Step<D> {
  if (!deck.loaded) return stay(deck)
  const ended = endAdjust(deck)
  if (ended) return ended
  const loop = current(deck)
  if (loop) {
    const doubled = { in: loop.in, out: loop.in + 2 * length(loop) }
    return beatsOf(doubled, grid) > MAX_BEATS + SAME_FRAMES || doubled.out > grid.end ? stay(deck) : stay(active(deck, doubled))
  }
  const start = deck.loop.pending ?? (deck.cue < position ? deck.cue : null)
  if (start === null) return stay(deck)
  const snapped = snap(deck, position, grid)
  const out = Math.min(deck.quantize && snapped === start ? start + grid.beat : snapped, grid.end)
  return tooShort(out - start, grid) ? stay(deck) : stay(active(deck, { in: start, out }))
}

// ASSUMPTION: replaces a pending in.
function autoLoop<D extends Looping>(deck: D, beats: number, position: number, grid: Grid): Step<D> {
  const loop = made(snap(deck, position, grid), beats, grid)
  return loop ? stay(active(deck, loop)) : stay(deck)
}

export function press4BeatExit<D extends Looping>(deck: D, position: number, grid: Grid): Step<D> {
  if (!deck.loaded) return stay(deck)
  if (deck.loop.active) return stay(looped(deck, { active: false, adjust: null }))
  return autoLoop(deck, AUTO_BEATS, position, grid)
}

// SHIFT+LOOP OUT. ASSUMPTION: plus the beat phase with quantize; play unchanged.
export function pressReloop<D extends Looping>(deck: D, position: number, grid: Grid): Step<D> {
  if (!deck.loaded) return stay(deck)
  const ended = endAdjust(deck)
  if (ended) return ended
  if (deck.loop.active) return stay(looped(deck, { adjust: 'out' }))
  const loop = deck.loop.stored
  if (!loop) return stay(deck)
  const phase = deck.quantize ? beatPhase(position, grid) % length(loop) : 0
  return { deck: active(deck, loop), seek: loop.in + phase }
}

// ASSUMPTION: nothing without a loop.
export function pressAdjustIn<D extends Looping>(deck: D): Step<D> {
  if (!deck.loaded) return stay(deck)
  return endAdjust(deck) ?? stay(deck.loop.active ? looped(deck, { adjust: 'in' }) : deck)
}

// ASSUMPTION: by the frames the jog would move the playhead.
export function adjustBy<D extends Looping>(deck: D, frames: number, grid: Grid): D {
  const loop = current(deck)
  if (!loop || deck.loop.adjust === null) return deck
  const min = MIN_BEATS * grid.beat
  const moved =
    deck.loop.adjust === 'in'
      ? { in: Math.max(0, Math.min(loop.in + frames, loop.out - min)), out: loop.out }
      : { in: loop.in, out: Math.min(grid.end, Math.max(loop.out + frames, loop.in + min)) }
  return looped(deck, { stored: moved })
}

// ASSUMPTION: another pad keeps in.
export function pressBeatLoop<D extends Looping>(deck: D, beats: number, position: number, grid: Grid): Step<D> {
  if (!deck.loaded) return stay(deck)
  const loop = current(deck)
  if (!loop) return autoLoop(deck, beats, position, grid)
  if (Math.abs(beatsOf(loop, grid) - beats) * grid.beat < SAME_FRAMES) return stay(looped(deck, { active: false, adjust: null }))
  const resized = made(loop.in, beats, grid)
  return resized ? stay(active(deck, resized)) : stay(deck)
}
