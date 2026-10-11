// Concern: a deck's master tempo on the FLX10: KEY SYNC held toggles it, SHIFT+QUANTIZE taps the tempo; the jog screen's symbol, BPM, speed | Non-concern: rendering | IO: controls -> deck -> outputs
import { showEachFrame, type Write } from '../../shared/outputs.ts'
import { follow } from '../../shared/streams.ts'
import type { Flx10Deck } from '../../shared/flx10.ts'
import type { Deck } from '../../shared/transport/deck.ts'
import { tapper } from './actions.ts'
import { playingBpm } from '../../shared/transport/bpm.ts'

function shown(controls: Flx10Deck, deck: Deck): Write[] {
  const s = deck.state.state
  const bpm = playingBpm(s, deck.song.bpm)
  const display = controls.display
  // 127 on (MML p.7).
  return [
    // ASSUMPTION: TAP's LED stays dark.
    { led: controls.shifted.quantize, on: false },
    { out: display.masterTempo, value: s.locked === null ? 0 : 127 },
    { out: display.bpm, value: Math.round(bpm * 10) / 10 },
    { out: display.playingSpeed, value: Math.round((bpm / deck.song.bpm - 1) * 1000) / 10 },
  ]
}

export function playMasterTempo(controls: Flx10Deck, deck: Deck, signal: AbortSignal): Promise<void>[] {
  const tap = tapper(deck)
  return [
    // MML p.2 D8, MAN p.14.
    follow(
      controls.keySync.presses({ signal }),
      (press) => {
        if (press.layer === 'long-press') deck.update({ masterTempo: !deck.state.state.masterTempo })
      },
      signal,
    ),
    // MML p.2 D21, MAN p.16.
    follow(controls.quantize.presses({ signal }), (press) => (press.shift ? tap(press.time) : undefined), signal),
    showEachFrame(() => shown(controls, deck), signal),
  ]
}
