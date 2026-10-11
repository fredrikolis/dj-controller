// Concern: the jog feature: each deck's platter scratching while touched in vinyl mode, nudging otherwise, from the FLX10 | Non-concern: the playhead | IO: (FeatureHandles) -> jogs
import { DECKS } from '../../shared/decks.ts'
import type { Feature } from '../../shared/feature.ts'
import { playJog } from './hardware.ts'

export const jog: Feature = async ({ desk, controller, signal }) => {
  try {
    await Promise.all(DECKS.flatMap((i) => playJog(controller.decks[i], desk.decks[i], signal)))
  } catch (err) {
    throw new Error('the jog stopped', { cause: err })
  }
}
