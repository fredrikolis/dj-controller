// Concern: one deck's key shift and Keyboard from page or controller: pads, KEY SYNC, KEY RESET, semitones, the hot cue chosen; the shift asked | Non-concern: the rules | IO: (press) -> deck state
import { other, type DeckIndex, type Pair } from '../../shared/decks.ts'
import { pad as hotCuePad } from '../../shared/hot-cues/actions.ts'
import { logger } from '../../shared/logger.ts'
import { createStore, type Watched } from '../../shared/store.ts'
import type { Deck } from '../../shared/transport/deck.ts'
import { keyedOf, shiftAskedOf } from '../../shared/transport/decks-key.ts'
import { KeySyncRefused, pitchOf, pressKeyboard, pressKeySync, RESET, shiftedTo, type Chosen } from './semitones.ts'

export type KeyShift = {
  readonly deck: Deck
  /** Keyboard's hot cue, null while choosing. */
  readonly chosen: Watched<Chosen>
  /** The shift asked now, a synced deck's following the other's key. */
  asked(): number
  /** Calls `seen` now and when either deck or the choice changes. */
  watch(seen: () => void, signal: AbortSignal): void
  shiftPad(page: number, pad: number): void
  keyboardPad(page: number, pad: number, time: number): void
  chooseAgain(): void
  keySync(): void
  reset(): void
  step(semitones: number): void
}

export function keyShiftOf(decks: Pair<Deck>, index: DeckIndex): KeyShift {
  const deck = decks[index]
  const chosen = createStore<Chosen>(null)
  const asked = () => shiftAskedOf(decks, index)
  return {
    deck,
    chosen,
    asked,
    watch(seen, signal) {
      for (const d of decks) d.state.watch(seen, signal)
      chosen.watch(seen, signal)
    },
    shiftPad: (page, pad) => deck.update(shiftedTo(pitchOf(page, pad))),
    keyboardPad(page, pad, time) {
      const step = pressKeyboard(chosen.state, deck.state.state.hotCues, page, pad)
      chosen.update(() => step.chosen)
      if (step.semitones !== null) deck.update(shiftedTo(step.semitones))
      if (step.hotCue !== null) hotCuePad(deck, step.hotCue, time)
    },
    chooseAgain: () => chosen.update(() => null),
    keySync() {
      try {
        deck.update(pressKeySync(keyedOf(decks, index), keyedOf(decks, other(index))))
      } catch (err) {
        if (!(err instanceof KeySyncRefused)) throw err
        logger.error('KEY SYNC was refused', err)
      }
    },
    reset: () => deck.update(RESET),
    step: (semitones) => deck.update(shiftedTo(asked() + semitones)),
  }
}
