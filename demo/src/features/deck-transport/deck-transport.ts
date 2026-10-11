// Concern: the deck transport feature: each deck's PLAY, CUE, reverse and TEMPO from the FLX10, its TEMPO range on its jog display | Non-concern: the rules, audio | IO: (FeatureHandles) -> deck state
import { DECKS } from '../../shared/decks.ts'
import type { Feature } from '../../shared/feature.ts'
import { playTransport } from './hardware.ts'

const JOGS = ['jog1', 'jog2'] as const

export const deckTransport: Feature = async ({ desk, controller, text, signal }) => {
  // MAN p.34 item 13: the playing speed adjustment range; the MIDI list has no output for it, so the twin's display takes it as text.
  for (const i of DECKS) desk.decks[i].state.watch((s) => text.show(JOGS[i], { range: `±${Math.round(s.tempoRange * 100)}%` }), signal)
  try {
    await Promise.all(DECKS.flatMap((i) => playTransport(controller.decks[i], desk.decks[i], signal)))
  } catch (err) {
    throw new Error('the deck transport stopped', { cause: err })
  }
}
