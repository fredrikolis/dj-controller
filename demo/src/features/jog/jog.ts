// Concern: the jog feature: each deck's platter scratching while touched in vinyl mode, nudging otherwise, from the page or the FLX10 | Non-concern: the playhead | IO: (FeatureHandles) -> jogs
import './jog.css'
import { DECKS } from '../../shared/decks.ts'
import type { Feature } from '../../shared/feature.ts'
import { playJog } from './hardware.ts'
import { showPlatter } from './screen.ts'

export const jog: Feature = async ({ desk, controller, shifts, view, signal }) => {
  const work = controller === null ? DECKS.map((i) => showPlatter(view.decks[i], desk.decks[i], shifts[i], signal)) : DECKS.flatMap((i) => playJog(controller.decks[i], desk.decks[i], signal))
  try {
    await Promise.all(work)
  } catch (err) {
    throw new Error('the jog stopped', { cause: err })
  }
}
