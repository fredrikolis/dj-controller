// Concern: one deck's sync master on the FLX10: SHIFT+BEAT SYNC in; its SHIFT-layer LED and the jog screen's MASTER out | Non-concern: what follows the master | IO: controls -> desk -> outputs
import type { DeckIndex } from '../../shared/decks.ts'
import type { Desk } from '../../shared/engine/engine.ts'
import type { Flx10Deck } from '../../shared/flx10.ts'
import { showEachFrame, type Write } from '../../shared/outputs.ts'
import { follow } from '../../shared/streams.ts'

function shown(controls: Flx10Deck, master: boolean): Write[] {
  // MML p.7: 127 on. ASSUMPTION: the SHIFT LED.
  return [
    { led: controls.beatSync, on: false },
    { led: controls.shifted.beatSync, on: master },
    { out: controls.display.beatSync.master, value: master ? 127 : 0 },
  ]
}

export function playSyncMaster(controls: Flx10Deck, desk: Desk, deck: DeckIndex, signal: AbortSignal): Promise<void>[] {
  return [
    // MML p.2 D6 9n 5C, MAN p.17.
    follow(controls.beatSync.presses({ signal }), (press) => (press.shift && press.layer === '' ? desk.chooseMaster(deck) : undefined), signal),
    showEachFrame(() => shown(controls, desk.syncMaster.state === deck), signal),
  ]
}
