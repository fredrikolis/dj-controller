// Concern: the loops feature: each deck's quantize, manual, auto and pad loops, RELOOP and adjust from the FLX10, each Beat Loop pad's beats on the twin | Non-concern: the rules | IO: handles -> decks
import { DECKS } from '../../shared/decks.ts'
import type { Feature } from '../../shared/feature.ts'
import { beatsText } from '../../shared/fx/beats.ts'
import { adjustWithJogs } from './actions.ts'
import { playLoops } from './hardware.ts'
import { PAD_BEATS } from './loop.ts'

const beats = (page: number, pad: number): string | undefined => {
  const size = PAD_BEATS[page]?.[pad]
  return size === undefined ? undefined : beatsText(size)
}

export const loops: Feature = async ({ desk, controller, text, signal }) => {
  for (const i of DECKS) {
    adjustWithJogs(desk.decks[i], signal)
    text.labelPads(controller.decks[i].modes.beatLoop, beats)
  }
  try {
    await Promise.all(DECKS.flatMap((i) => playLoops(controller.decks[i], desk.decks[i], signal)))
  } catch (err) {
    throw new Error('the loops stopped', { cause: err })
  }
}
