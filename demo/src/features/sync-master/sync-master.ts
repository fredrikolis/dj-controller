// Concern: the sync master feature: a deck made the master by SHIFT+BEAT SYNC on the FLX10 or MASTER on the page | Non-concern: the rule, what follows it | IO: (FeatureHandles) -> desk, DOM, outputs
import './sync-master.css'
import { DECKS } from '../../shared/decks.ts'
import type { Feature } from '../../shared/feature.ts'
import { playSyncMaster } from './hardware.ts'
import { showSyncMaster } from './screen.ts'

export const syncMaster: Feature = async ({ desk, controller, view, signal }) => {
  if (controller === null) return DECKS.forEach((i) => showSyncMaster(view.decks[i], desk, i, signal))
  try {
    await Promise.all(DECKS.flatMap((i) => playSyncMaster(controller.decks[i], desk, i, signal)))
  } catch (err) {
    throw new Error('the sync master stopped', { cause: err })
  }
}
