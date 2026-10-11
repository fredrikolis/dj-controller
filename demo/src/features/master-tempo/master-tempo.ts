// Concern: the master tempo feature: key lock by SVA re-renders or none, toggled by KEY SYNC held, TAP, the BPM on the jog display | Non-concern: the fader | IO: (FeatureHandles) -> renders, outputs
import { DECKS } from '../../shared/decks.ts'
import type { Feature } from '../../shared/feature.ts'
import { playMasterTempo } from './hardware.ts'
import { keepKeyLock } from './key-lock.ts'

export const masterTempo: Feature = async ({ desk, controller, signal }) => {
  try {
    await Promise.all([...DECKS.map((i) => keepKeyLock(desk.decks, i, signal)), ...DECKS.flatMap((i) => playMasterTempo(controller.decks[i], desk.decks[i], signal))])
  } catch (err) {
    throw new Error('master tempo stopped', { cause: err })
  }
}
