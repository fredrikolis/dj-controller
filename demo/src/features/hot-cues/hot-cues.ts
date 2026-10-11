// Concern: the hot cues feature: each deck's 16 hot cues and hot loops set, called and cleared from the FLX10, each pad's letter on the twin | Non-concern: the rules (hot-cue.ts) | IO: handles -> decks
import { DECKS } from '../../shared/decks.ts'
import type { Feature } from '../../shared/feature.ts'
import { slotOf } from '../../shared/hot-cues/hot-cue.ts'
import { slotName } from '../../shared/transport/hot-cue-state.ts'
import { playHotCues } from './hardware.ts'

export const hotCues: Feature = async ({ desk, controller, text, signal }) => {
  for (const i of DECKS) text.labelPads(controller.decks[i].modes.hotCue, (page, pad) => slotName(slotOf(page, pad)))
  try {
    await Promise.all(DECKS.flatMap((i) => playHotCues(controller.decks[i], desk.decks[i], signal)))
  } catch (err) {
    throw new Error('the hot cues stopped', { cause: err })
  }
}
