// Concern: the mixer on the FLX10: channels 1 and 2's faders, EQ, assign switches, fader start and the crossfader in; level meters out | Non-concern: the curves | IO: (controls) -> mix; levels -> meters
import type { Absolute } from 'dj-controller'
import { DECKS, type DeckIndex, type Pair } from '../../shared/decks.ts'
import type { Flx10 } from '../../shared/flx10.ts'
import { ASSIGNS } from '../../shared/mixer/curves.ts'
import { BANDS, type Mixer } from '../../shared/mixer/mixer.ts'
import { showEachFrame } from '../../shared/outputs.ts'
import { follow } from '../../shared/streams.ts'
import type { Deck } from '../../shared/transport/deck.ts'
import type { Move } from './fader-start.ts'
import { start } from './start.ts'

function position(control: Absolute, act: (position: number) => void, signal: AbortSignal): Promise<void> {
  if (control.value !== undefined) act(control.value / control.max)
  return follow(control.changes({ signal }), (value) => act(value / control.max), signal)
}

function channel(flx: Flx10, mixer: Mixer, decks: Pair<Deck>, deck: DeckIndex, signal: AbortSignal): Promise<void>[] {
  const controls = flx.mixer.channels[deck]
  const moved = (move: Move) => ({ on }: { readonly on: boolean }) => (on ? start(decks[deck], move) : undefined)
  const starts = controls.faderStart
  const assigns = ASSIGNS.map((assign) => {
    const side = controls.crossfaderAssign[assign]
    if (side.on) mixer.assign(deck, assign)
    return follow(
      side.changes({ signal }),
      ({ on }) => {
        if (on) mixer.assign(deck, assign)
      },
      signal,
    )
  })
  return [
    position(controls.fader, (p) => mixer.fader(deck, p), signal),
    ...BANDS.map((band) => position(controls.eq[band], (p) => mixer.eq(deck, band, p), signal)),
    ...assigns,
    // MML p.2 M1/M2, sent with SHIFT held (MAN p.91); unobserved. ASSUMPTION: 9n 5D, the list's +SHIFT row, starts as 9n 66; on is the move.
    follow(starts.leavesZero.changes({ signal }), moved('leaves-zero'), signal),
    follow(controls.shifted.faderStart.leavesZero.changes({ signal }), moved('leaves-zero'), signal),
    follow(starts.reachesZero.changes({ signal }), moved('reaches-zero'), signal),
  ]
}

// MAN p.52: CH CUE and its SHIFT layer, Part ISO, go unread: no headphone cue, no parts.
export function playMixer(flx: Flx10, mixer: Mixer, decks: Pair<Deck>, signal: AbortSignal): Promise<void>[] {
  // The meter's scale is unobserved.
  const meters = () => DECKS.map((d) => ({ out: flx.mixer.channels[d].levelMeter, value: Math.round(mixer.level(d) * 127) }))
  return [...DECKS.flatMap((d) => channel(flx, mixer, decks, d, signal)), position(flx.mixer.crossfader, mixer.crossfader, signal), showEachFrame(meters, signal)]
}
