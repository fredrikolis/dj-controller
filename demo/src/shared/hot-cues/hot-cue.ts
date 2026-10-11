// Concern: hot cues as rekordbox plays them on a DDJ-FLX10: a pad sets an empty slot or calls a set one, SHIFT+pad clears it | Non-concern: the pads' MIDI, lights | IO: (deck, press) -> deck, seek
import type { DeckState } from '../transport/deck-state.ts'
import { beatPhase, snapped, type Grid } from '../transport/grid.ts'
import type { HotCue } from '../transport/hot-cue-state.ts'
import { activeLoop, looping, sought, type LoopPoints } from '../transport/loop-state.ts'

export type Cueing = Pick<DeckState, 'loaded' | 'playing' | 'previewing' | 'cue' | 'quantize' | 'loop' | 'hotCues'>

export type Step<D extends Cueing> = { readonly deck: D; readonly seek: number | null }

const stay = <D extends Cueing>(deck: D): Step<D> => ({ deck, seek: null })

// MML p.4-6 P1-P8: 9p 00-07, 08-0F.
export const slotOf = (page: number, pad: number): number => page * 8 + pad

const stored = <D extends Cueing>(deck: D, slot: number, cue: HotCue | null): D => ({ ...deck, hotCues: deck.hotCues.map((c, i) => (i === slot ? cue : c)) })

export function calledSlot(deck: Pick<Cueing, 'loop' | 'hotCues'>): number | null {
  const loop = activeLoop(deck.loop)
  if (!loop) return null
  const slot = deck.hotCues.findIndex((c) => c?.kind === 'loop' && c.in === loop.in && c.out === loop.out)
  return slot < 0 ? null : slot
}

// RB p.245. ASSUMPTION: a preview plays.
const phaseOf = (deck: Cueing, position: number, grid: Grid): number => (deck.quantize && deck.playing ? beatPhase(position, grid) : 0)

// ASSUMPTION: a pending in is no loop; nothing else moves.
function set<D extends Cueing>(deck: D, slot: number, position: number, grid: Grid): Step<D> {
  const loop = activeLoop(deck.loop)
  const cue: HotCue = loop ? { kind: 'loop', in: loop.in, out: loop.out } : { kind: 'cue', at: Math.min(snapped(deck.quantize, position, grid), grid.end) }
  return stay(stored(deck, slot, cue))
}

// ASSUMPTION: ends a CUE preview.
function jump<D extends Cueing>(deck: D, to: number, loop: LoopPoints | null): Step<D> {
  return { deck: { ...deck, playing: true, previewing: false, loop: loop ? looping(loop) : sought(deck.loop, to) }, seek: to }
}

// RB p.165, p.241. ASSUMPTION: no song, nothing.
export function pressPad<D extends Cueing>(deck: D, slot: number, position: number, grid: Grid): Step<D> {
  if (!deck.loaded) return stay(deck)
  const cue = deck.hotCues[slot]
  if (cue === null) return set(deck, slot, position, grid)
  const phase = phaseOf(deck, position, grid)
  if (cue.kind === 'cue') return jump(deck, cue.at + phase, null)
  // ASSUMPTION: a re-press restarts, no exit.
  return jump(deck, cue.in + (phase % (cue.out - cue.in)), { in: cue.in, out: cue.out })
}

// ASSUMPTION: no jump, its loop keeps looping; empty, nothing.
export function pressShiftPad<D extends Cueing>(deck: D, slot: number): Step<D> {
  if (!deck.loaded || deck.hotCues[slot] === null) return stay(deck)
  return stay(stored(deck, slot, null))
}
