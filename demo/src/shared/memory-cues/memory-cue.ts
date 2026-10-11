// Concern: memory cues and loops as rekordbox plays them on a DDJ-FLX10: MEMORY, CALL ◀/▶, DELETE, Active Loop, one reached, its LED | Non-concern: the buttons, the wrap | IO: (deck, press) -> deck
import type { DeckState } from '../transport/deck-state.ts'
import { activeLoop, looping, sought, type Loop, type LoopPoints } from '../transport/loop-state.ts'
import { frameOf, MAX_MEMORY_CUES, type MemoryCue, type MemoryCues } from '../transport/memory-cue-state.ts'

export type Remembering = Pick<DeckState, 'loaded' | 'playing' | 'previewing' | 'cue' | 'loop' | 'memoryCues'>

export type Step<D extends Remembering> = { readonly deck: D; readonly seek: number | null }

export type Direction = -1 | 1

export class MemoryCuesFull extends Error {
  override name = 'MemoryCuesFull'
}

// As CUE's tolerance (cdj.ts).
const AT_FRAMES = 64

// ASSUMPTION: faster is a seek (2x WIDE plus a 4x search, with room).
export const PLAY_SPEED_LIMIT = 8

const stay = <D extends Remembering>(deck: D): Step<D> => ({ deck, seek: null })

const samePoints = (a: LoopPoints, b: LoopPoints): boolean => a.in === b.in && a.out === b.out

const same = (a: MemoryCue, b: MemoryCue): boolean => (a.kind === 'cue' ? b.kind === 'cue' && a.at === b.at : b.kind === 'loop' && samePoints(a, b))

const order = (a: MemoryCue, b: MemoryCue): number => frameOf(a) - frameOf(b) || (a.kind === 'cue' ? -1 : b.kind === 'cue' ? 1 : a.out - b.out)

const remembered = <D extends Remembering>(deck: D, memoryCues: MemoryCues): D => ({ ...deck, memoryCues })

export function calledLoopOf(deck: Pick<Remembering, 'loop' | 'memoryCues'>): number | null {
  const stored = deck.loop.stored
  const i = stored === null ? -1 : deck.memoryCues.findIndex((p) => p.kind === 'loop' && samePoints(p, stored))
  return i < 0 ? null : i
}

// ASSUMPTION: called until the cue point or deck loop moves.
export function calledOf(deck: Pick<Remembering, 'cue' | 'loop' | 'memoryCues'>): number | null {
  const loop = calledLoopOf(deck)
  if (loop !== null) return loop
  const cue = deck.memoryCues.findIndex((p) => p.kind === 'cue' && p.at === deck.cue)
  return cue < 0 ? null : cue
}

// MAN p.87; RB p.161, p.163, p.164. ASSUMPTION: loop play only; no snap (RB p.159); no duplicate.
export function pressMemory<D extends Remembering>(deck: D): Step<D> {
  if (!deck.loaded) return stay(deck)
  const loop = activeLoop(deck.loop)
  const point: MemoryCue = loop ? { kind: 'loop', active: false, in: loop.in, out: loop.out } : { kind: 'cue', at: deck.cue }
  if (deck.memoryCues.some((p) => same(p, point))) return stay(deck)
  if (deck.memoryCues.length >= MAX_MEMORY_CUES) {
    throw new MemoryCuesFull(
      `MEMORY would save a memory ${point.kind} at frame ${frameOf(point)}, but the song already holds ${MAX_MEMORY_CUES} memory cues and loops, rekordbox's limit for a track (RB p.161); call one and DELETE it (SHIFT+CUE/LOOP CALL ▶) first`,
    )
  }
  return stay(remembered(deck, [...deck.memoryCues, point].sort(order)))
}

// MAN p.87; RB p.161, p.163, p.164. ASSUMPTION: by position, as a CDJ; no quantize.
export function pressCall<D extends Remembering>(deck: D, direction: Direction, position: number): Step<D> {
  if (!deck.loaded) return stay(deck)
  const point = direction === 1 ? deck.memoryCues.find((p) => frameOf(p) > position + AT_FRAMES) : deck.memoryCues.findLast((p) => frameOf(p) < position - AT_FRAMES)
  if (point === undefined) return stay(deck)
  const to = frameOf(point)
  // ASSUMPTION: stored, not looping.
  const loop: Loop = point.kind === 'loop' ? { stored: { in: point.in, out: point.out }, active: false, pending: null, adjust: null } : sought(deck.loop, to)
  return { deck: { ...deck, playing: false, previewing: false, cue: to, loop }, seek: to }
}

// MAN pp.87-88. ASSUMPTION: nothing else changes.
export function pressDelete<D extends Remembering>(deck: D): Step<D> {
  if (!deck.loaded) return stay(deck)
  const called = calledOf(deck)
  return called === null ? stay(deck) : stay(remembered(deck, deck.memoryCues.filter((_, i) => i !== called)))
}

const distance = (loop: LoopPoints, position: number): number => (position < loop.in ? loop.in - position : position >= loop.out ? position - loop.out : 0)

function nearestLoop(memoryCues: MemoryCues, position: number): number | null {
  let nearest: number | null = null
  let best = Infinity
  memoryCues.forEach((p, i) => {
    if (p.kind !== 'loop' || distance(p, position) >= best) return
    nearest = i
    best = distance(p, position)
  })
  return nearest
}

// MAN p.22. ASSUMPTION: paused too; loop play unchanged.
export function pressActiveLoop<D extends Remembering>(deck: D, position: number): Step<D> {
  if (!deck.loaded) return stay(deck)
  const target = calledLoopOf(deck) ?? nearestLoop(deck.memoryCues, position)
  if (target === null) return stay(deck)
  return stay(remembered(deck, deck.memoryCues.map((p, i) => (i === target && p.kind === 'loop' ? { ...p, active: !p.active } : p))))
}

// ASSUMPTION: as CDJs play an Active Loop (RB p.164 defers to them).
export function reached(deck: Pick<Remembering, 'loaded' | 'loop' | 'memoryCues'>, from: number, to: number, most: number): LoopPoints | null {
  if (!deck.loaded || deck.loop.active || !(to > from) || to - from > most) return null
  const loop = deck.memoryCues.find((p) => p.kind === 'loop' && p.active && from <= p.in && p.in < to)
  return loop?.kind === 'loop' ? { in: loop.in, out: loop.out } : null
}

export const engaged = <D extends Remembering>(deck: D, loop: LoopPoints): D => ({ ...deck, loop: looping(loop) })

// MML D16 9n 50. ASSUMPTION: lit while the deck loop is an Active Loop.
export function activeLoopLit(deck: Pick<Remembering, 'loop' | 'memoryCues'>): boolean {
  const called = calledLoopOf(deck)
  const point = called === null ? undefined : deck.memoryCues[called]
  return point?.kind === 'loop' && point.active
}
