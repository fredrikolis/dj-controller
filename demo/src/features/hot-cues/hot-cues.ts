// Concern: the hot cues feature: each deck's 16 hot cues and hot loops, set, called and cleared from the page or the FLX10 | Non-concern: the rules (hot-cue.ts) | IO: (FeatureHandles) -> decks
import './hot-cues.css'
import { DECKS } from '../../shared/decks.ts'
import type { Feature } from '../../shared/feature.ts'
import { playHotCues } from './hardware.ts'
import { paintCues, showHotCues } from './screen.ts'

export const hotCues: Feature = async ({ desk, controller, shifts, view, signal }) => {
  const areas = DECKS.map((i) => showHotCues(view.decks[i], desk.decks[i], shifts === null ? null : shifts[i], signal))
  try {
    await Promise.all([paintCues(areas, signal), ...(controller === null ? [] : DECKS.flatMap((i) => playHotCues(controller.decks[i], desk.decks[i], signal)))])
  } catch (err) {
    throw new Error('the hot cues stopped', { cause: err })
  }
}
