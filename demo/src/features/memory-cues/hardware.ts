// Concern: one deck's memory cues on the FLX10: CUE/LOOP CALL ◀/▶ and their SHIFT layers in; they have no LEDs | Non-concern: the rules, Active Loop (loops) | IO: controls -> deck
import type { Flx10Deck } from '../../shared/flx10.ts'
import { call, deleteCalled, memory } from '../../shared/memory-cues/actions.ts'
import { follow } from '../../shared/streams.ts'
import type { Deck } from '../../shared/transport/deck.ts'

// MML p.2 D12 9n 51 / SHIFT 9n 3D, D13 9n 53 / SHIFT 9n 3E, no MIDI out; MAN pp.14-15.
export function playMemoryCues(controls: Flx10Deck, deck: Deck, signal: AbortSignal): Promise<void>[] {
  const { left, right } = controls.cueLoopCall
  return [
    follow(left.presses({ signal }), (press) => (press.shift ? memory(deck) : call(deck, -1, press.time)), signal),
    follow(right.presses({ signal }), (press) => (press.shift ? deleteCalled(deck) : call(deck, 1, press.time)), signal),
  ]
}
