// Concern: one deck's transport on the FLX10: PLAY, CUE, SLIP REVERSE, TEMPO and its range in; their LEDs and elapsed time out | Non-concern: the rules | IO: (controls) -> deck; deck -> outputs
import { showEachFrame, type Write } from '../../shared/outputs.ts'
import { follow, until } from '../../shared/streams.ts'
import type { Flx10Deck } from '../../shared/flx10.ts'
import type { Deck } from '../../shared/transport/deck.ts'
import { atCue } from './cdj.ts'
import { cueDown, cueUp, play, reverse, stepRange } from './press.ts'

function shown(controls: Flx10Deck, deck: Deck): Write[] {
  const s = deck.state.state
  const display = controls.display
  const elapsed = Math.max(0, Math.floor(deck.position / deck.sampleRate))
  const playing = s.playing
  const cue = s.previewing || (!s.playing && s.loaded && atCue(s, deck.position))
  // MML p.7: time mode 0 elapsed. ASSUMPTION: the SHIFT layers light as PLAY and CUE.
  return [
    { led: controls.playPause, on: playing },
    { led: controls.shifted.playPause, on: playing },
    { led: controls.cue, on: cue },
    { led: controls.shifted.cue, on: cue },
    { led: controls.slipReverse, on: false },
    { led: controls.shifted.slipReverse, on: s.reverse },
    // MML p.7: hide 127. ASSUMPTION: hidden with no track.
    { out: display.hideInfo, value: s.loaded ? 0 : 127 },
    { out: display.timeMode, value: 0 },
    { out: display.time.minutes, value: Math.floor(elapsed / 60) % 100 },
    { out: display.time.seconds, value: elapsed % 60 },
  ]
}

export function playTransport(controls: Flx10Deck, deck: Deck, signal: AbortSignal): Promise<void>[] {
  const tempo = controls.tempo
  if (tempo.value !== undefined) deck.update({ tempo: tempo.value / tempo.max })
  return [
    follow(controls.playPause.presses({ signal }), (press) => play(deck, press.shift), signal),
    follow(
      controls.cue.presses({ signal }),
      async (press) => {
        cueDown(deck, press.shift)
        await until(press.released, signal)
        cueUp(deck)
      },
      signal,
    ),
    follow(controls.slipReverse.presses({ signal }), (press) => reverse(deck, press.shift), signal),
    // MAN p.17 item 12. ASSUMPTION: a plain press does nothing.
    follow(controls.tempoReset.presses({ signal }), (press) => (press.shift ? stepRange(deck) : undefined), signal),
    // Higher is faster (docs/research/flx10-observed-tempo.md).
    follow(tempo.changes({ signal }), (value) => deck.update({ tempo: value / tempo.max }), signal),
    showEachFrame(() => shown(controls, deck), signal),
  ]
}
