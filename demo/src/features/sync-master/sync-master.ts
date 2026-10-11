// Concern: the sync master feature: a deck made the master by SHIFT+BEAT SYNC on the FLX10 | Non-concern: the rule, what follows it | IO: (FeatureHandles) -> desk, outputs
import { DECKS } from '../../shared/decks.ts'
import type { Feature } from '../../shared/feature.ts'
import { playSyncMaster } from './hardware.ts'

export const syncMaster: Feature = async ({ desk, controller, signal }) => {
  try {
    await Promise.all(DECKS.flatMap((i) => playSyncMaster(controller.decks[i], desk, i, signal)))
  } catch (err) {
    throw new Error('the sync master stopped', { cause: err })
  }
}
