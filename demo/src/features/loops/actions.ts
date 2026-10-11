// Concern: loop presses on one deck, from page or controller, applied at the press's time; jogs taken while a point is adjusted | Non-concern: the rules (loop.ts) | IO: (deck, time) -> seek, state
import type { DeckState } from '../../shared/transport/deck-state.ts'
import type { Deck } from '../../shared/transport/deck.ts'
import { gridOf } from '../../shared/transport/grid.ts'
import type { LoopStart } from '../../shared/view.ts'
import { adjustBy, press4BeatExit, pressAdjustIn, pressBeatLoop, pressLoopIn, pressLoopOut, pressQuantize, pressReloop, type Step } from './loop.ts'

function apply(deck: Deck, { deck: next, seek }: Step<DeckState>): void {
  if (seek !== null) deck.seek(seek)
  deck.update({ cue: next.cue, quantize: next.quantize, loop: next.loop })
}

type Press = (deck: Deck, time: number) => void

export const quantize = (deck: Deck): void => apply(deck, pressQuantize(deck.state.state))

export const loopIn: Press = (deck, time) => apply(deck, pressLoopIn(deck.state.state, deck.positionAt(time), gridOf(deck)))

export const loopOut: Press = (deck, time) => apply(deck, pressLoopOut(deck.state.state, deck.positionAt(time), gridOf(deck)))

export const fourBeatExit: Press = (deck, time) => apply(deck, press4BeatExit(deck.state.state, deck.positionAt(time), gridOf(deck)))

export const reloop: Press = (deck, time) => apply(deck, pressReloop(deck.state.state, deck.positionAt(time), gridOf(deck)))

export const adjustIn = (deck: Deck): void => apply(deck, pressAdjustIn(deck.state.state))

export const beatLoop = (deck: Deck, beats: number, time: number): void => apply(deck, pressBeatLoop(deck.state.state, beats, deck.positionAt(time), gridOf(deck)))

export function adjustWithJogs(deck: Deck, signal: AbortSignal): void {
  let taking: AbortController | null = null
  deck.state.watch((s) => {
    if ((s.loop.adjust !== null) === (taking !== null)) return
    if (taking) {
      taking.abort()
      taking = null
      return
    }
    taking = new AbortController()
    deck.takeJogs((frames) => deck.update({ loop: adjustBy(deck.state.state, frames, gridOf(deck)).loop }), AbortSignal.any([signal, taking.signal]))
  }, signal)
}

export function startLoop(deck: Deck, start: LoopStart): void {
  const grid = gridOf(deck)
  const press = (step: (s: DeckState) => Step<DeckState>) => apply(deck, step(deck.state.state))
  if (start === 'pending') return press((s) => pressLoopIn(s, 0, grid))
  press((s) => press4BeatExit(s, 0, grid))
  if (start === 'adjust') press(pressAdjustIn)
  if (start === 'stored') press((s) => press4BeatExit(s, 0, grid))
}
