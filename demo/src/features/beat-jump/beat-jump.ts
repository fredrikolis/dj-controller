// Concern: the beat jump feature: each deck's 4 BEAT JUMP and BEAT JUMP pads from the page or the FLX10 | Non-concern: the rules (jump.ts) | IO: (FeatureHandles) -> decks
import './beat-jump.css'
import { DECKS } from '../../shared/decks.ts'
import type { Feature } from '../../shared/feature.ts'
import { playBeatJump } from './hardware.ts'
import { showBeatJump } from './screen.ts'

export const beatJump: Feature = async ({ desk, controller, shifts, view, signal }) => {
  if (controller === null) {
    for (const i of DECKS) showBeatJump(view.decks[i], desk.decks[i], shifts[i], signal)
    return
  }
  try {
    await Promise.all(DECKS.flatMap((i) => playBeatJump(controller.decks[i], desk.decks[i], signal)))
  } catch (err) {
    throw new Error('the beat jump stopped', { cause: err })
  }
}
