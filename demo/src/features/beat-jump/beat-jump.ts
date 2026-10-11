// Concern: the beat jump feature: each deck's 4 BEAT JUMP and BEAT JUMP pads from the FLX10, each pad's jump on the twin | Non-concern: the rules (jump.ts) | IO: (FeatureHandles) -> decks
import { DECKS } from '../../shared/decks.ts'
import type { Feature } from '../../shared/feature.ts'
import { beatsText } from '../../shared/fx/beats.ts'
import { playBeatJump } from './hardware.ts'
import { padJump } from './jump.ts'

const jumpText = (page: number, pad: number): string => {
  const { beats, direction } = padJump(page, pad)
  return direction < 0 ? `◀ ${beatsText(beats)}` : `${beatsText(beats)} ▶`
}

export const beatJump: Feature = async ({ desk, controller, text, signal }) => {
  for (const i of DECKS) text.labelPads(controller.decks[i].modes.beatJump, jumpText)
  try {
    await Promise.all(DECKS.flatMap((i) => playBeatJump(controller.decks[i], desk.decks[i], signal)))
  } catch (err) {
    throw new Error('the beat jump stopped', { cause: err })
  }
}
