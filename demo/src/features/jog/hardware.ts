// Concern: one deck's jog on the FLX10: platter, side, touch and SHIFT+SLIP vinyl mode in; ring, markers, SLIP LEDs out | Non-concern: what a turn does | IO: (controls) -> jogs; deck -> jog screen
import { showEachFrame, type Write } from '../../shared/outputs.ts'
import { follow, until } from '../../shared/streams.ts'
import type { Flx10Deck } from '../../shared/flx10.ts'
import { followJog, jogRevolutions } from '../../shared/jog-turns.ts'
import type { Deck } from '../../shared/transport/deck.ts'
import { framesOf, turnOf } from './turns.ts'
import { holds, switched } from './vinyl.ts'

const degrees = (frames: number, sampleRate: number): number => Math.floor(turnOf(frames, sampleRate) * 360) % 360

function shown(controls: Flx10Deck, deck: Deck): Write[] {
  const display = controls.display
  // MML p.7: no hide for the marker; SHIFT twice (MAN p.20) and SHIFT+PAGE (p.33) are the HID screen's. MAN p.88: SLIP's SHIFT LED is vinyl; no Slip mode.
  return [
    { out: controls.jog.ring, value: 1 },
    { out: display.digitalMarker, value: degrees(deck.position, deck.sampleRate) },
    { out: display.cuePoint, value: degrees(deck.state.state.cue, deck.sampleRate) },
    { led: controls.slip, on: false },
    { led: controls.shifted.slip, on: deck.state.state.vinyl },
  ]
}

export function playJog(controls: Flx10Deck, deck: Deck, signal: AbortSignal): Promise<void>[] {
  const jog = controls.jog
  const revolutions = jogRevolutions(jog)
  const turn = (turns: number) => deck.jog(framesOf(turns, deck.state.state.touched, deck.sampleRate))
  return [
    follow(
      jog.touch.presses({ signal }),
      async (press) => {
        if (!holds(press.shift, deck.state.state.vinyl)) return
        deck.update({ touched: true })
        await until(press.released, signal)
        deck.update({ touched: false })
      },
      signal,
    ),
    // MAN p.16 item 7, p.88; MML p.2 D22.
    follow(controls.slip.presses({ signal }), (press) => (press.shift ? deck.update(switched(deck.state.state)) : undefined), signal),
    // The SHIFT turns, the shifted views', go unread (vinyl.ts).
    followJog(jog.platter, revolutions.platter, (turns, at) => (at.latest?.layer === '4-beat-jump' ? undefined : turn(turns)), signal),
    followJog(jog.side, revolutions.side, turn, signal),
    showEachFrame(() => shown(controls, deck), signal),
  ]
}
