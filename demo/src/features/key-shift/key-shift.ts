// Concern: the key shift feature: each deck's key shifted, synced, reset and played as a keyboard from the FLX10, each pad's semitones on the twin | Non-concern: the rules | IO: handles -> decks
import { DECKS } from '../../shared/decks.ts'
import type { Feature } from '../../shared/feature.ts'
import { keyShiftOf } from './actions.ts'
import { playKeyShift, showKeyFormat } from './hardware.ts'

export const keyShift: Feature = async ({ desk, controller, text, signal }) => {
  const keys = [keyShiftOf(desk.decks, 0), keyShiftOf(desk.decks, 1)] as const
  try {
    await Promise.all([showKeyFormat(controller, signal), ...DECKS.flatMap((i) => playKeyShift(controller.decks[i], keys[i], text, signal))])
  } catch (err) {
    throw new Error('the key shift stopped', { cause: err })
  }
}
