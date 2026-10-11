// Concern: one deck's PAD FX from page or controller: its holds, its unit on its channel, told the effects on and the beat | Non-concern: the rules, the audio (unit.ts) | IO: (deck, press) -> unit
import type { DeckIndex } from '../../shared/decks.ts'
import type { Desk } from '../../shared/engine/engine.ts'
import { logger } from '../../shared/logger.ts'
import { createStore, type Watched } from '../../shared/store.ts'
import { playingBpm } from '../../shared/transport/bpm.ts'
import type { Deck } from '../../shared/transport/deck.ts'
import { gridOf } from '../../shared/transport/grid.ts'
import { activeOf, letGo, NOTHING_HELD, pressed, stepped, type Holding } from './hold.ts'
import { createPadFxUnit } from './unit.ts'

export type DeckFx = {
  readonly holding: Watched<Holding>
  hold(slot: number): () => void
  step(direction: -1 | 1): void
  tick(): void
}

/** A press or BEAT step the unit cannot play, refused with the holds unchanged. */
export class PadFxRefused extends Error {
  override name = 'PadFxRefused'
}

/** `act`, or null where it was refused, the refusal logged; any other failure thrown. */
export function unlessRefused<T>(act: () => T): T | null {
  try {
    return act()
  } catch (err) {
    if (!(err instanceof PadFxRefused)) throw err
    logger.error('the PAD FX press was refused', err)
    return null
  }
}

export function startPadFx(desk: Desk, i: DeckIndex, signal: AbortSignal): DeckFx {
  const deck: Deck = desk.decks[i]
  const unit = createPadFxUnit(desk.context, deck.song.bpm, signal)
  desk.insert(i, unit, signal)
  const holding = createStore<Holding>(NOTHING_HELD)
  const bpm = () => playingBpm(deck.state.state, deck.song.bpm)
  holding.watch((h) => unit.apply(activeOf(h), bpm()), signal)
  const grid = gridOf(deck)
  let presses = 0
  const change = (next: Holding) => {
    const refused = unit.refusal(activeOf(next), bpm())
    if (refused !== null) throw new PadFxRefused(`deck ${i + 1}: ${refused}`)
    holding.update(() => next)
  }
  return {
    holding,
    hold(slot) {
      const id = ++presses
      change(pressed(holding.state, id, slot))
      return () => holding.update((h) => letGo(h, id))
    },
    step: (direction) => change(stepped(holding.state, direction)),
    tick() {
      const s = deck.state.state
      unit.tick(s.loaded && s.playing ? (deck.positionAt(performance.now()) - grid.first) / grid.beat : null, bpm())
    },
  }
}
