// Concern: beat jump as rekordbox plays it: whole beats either way, an active loop moved along, the pads' sizes, search speeds | Non-concern: the controls | IO: (deck, beats, position) -> deck, seek
import type { DeckState } from '../../shared/transport/deck-state.ts'
import type { Grid } from '../../shared/transport/grid.ts'
import { activeLoop } from '../../shared/transport/loop-state.ts'

export type Direction = -1 | 1

export type Jumping = Pick<DeckState, 'loaded' | 'loop'>

export type Step<D extends Jumping> = { readonly deck: D; readonly seek: number | null }

// MAN p.19 item 21.
export const buttonBeats = (shift: boolean): number => (shift ? 16 : 4)

// MAN p.82: left, right; ASSUMPTION: page 2 (RB p.169).
export const PAD_BEATS: readonly (readonly number[])[] = [
  [1, 2, 4, 8],
  [16, 32, 64, 128],
]

export function padJump(page: number, pad: number): { readonly beats: number; readonly direction: Direction } {
  const beats = PAD_BEATS[page]?.[Math.floor(pad / 2)]
  if (beats === undefined || !Number.isInteger(pad) || pad < 0) throw new RangeError(`no beat jump pad ${pad} on page ${page}: the FLX10 has pads 0 to 7 on pages 0 and 1 (MML p.7 *1)`)
  return { beats, direction: pad % 2 === 0 ? -1 : 1 }
}

// MAN pp.19-20. ASSUMPTION: both speeds.
export const SEARCH_SPEED = 4
const SEARCH_BEATS_A_TURN = 32

export const searchFrames = (turns: number, grid: Grid): number => turns * SEARCH_BEATS_A_TURN * grid.beat

const inTrack = (frame: number, grid: Grid): boolean => frame >= 0 && frame < grid.end

// MAN p.82; RB p.245 leaves it unquantized; RB p.135. ASSUMPTION: none leaving the track.
export function jumped<D extends Jumping>(deck: D, position: number, beats: number, direction: Direction, grid: Grid): Step<D> {
  const by = direction * beats * grid.beat
  const to = position + by
  const loop = activeLoop(deck.loop)
  if (!deck.loaded || !inTrack(to, grid)) return { deck, seek: null }
  if (!loop) return { deck, seek: to }
  const moved = { in: loop.in + by, out: loop.out + by }
  if (moved.in < 0 || moved.out > grid.end) return { deck, seek: null }
  return { deck: { ...deck, loop: { ...deck.loop, stored: moved } }, seek: to }
}
