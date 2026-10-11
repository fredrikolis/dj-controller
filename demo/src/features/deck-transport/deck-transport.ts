// Concern: the deck transport feature: each deck's title, PLAY, CUE, reverse and TEMPO from the page or the FLX10 | Non-concern: the rules, audio | IO: (FeatureHandles) -> deck state, DOM, outputs
import './deck-transport.css'
import { DECKS } from '../../shared/decks.ts'
import type { Feature } from '../../shared/feature.ts'
import { playTransport } from './hardware.ts'
import { showTransport } from './screen.ts'

export const deckTransport: Feature = async ({ desk, controller, shifts, view, signal }) => {
  for (const i of DECKS) showTransport(view.decks[i], desk.decks[i], shifts === null ? null : shifts[i], signal)
  if (controller === null) return
  try {
    await Promise.all(DECKS.flatMap((i) => playTransport(controller.decks[i], desk.decks[i], signal)))
  } catch (err) {
    throw new Error('the deck transport stopped', { cause: err })
  }
}
