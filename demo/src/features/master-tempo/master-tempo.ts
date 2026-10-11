// Concern: the master tempo feature: key lock by SVA re-renders or none, toggled on the page or by KEY SYNC held, TAP, the BPM shown | Non-concern: the fader | IO: (FeatureHandles) -> renders, DOM
import './master-tempo.css'
import { DECKS } from '../../shared/decks.ts'
import type { Feature } from '../../shared/feature.ts'
import { playMasterTempo } from './hardware.ts'
import { keepKeyLock } from './key-lock.ts'
import { showMasterTempo } from './screen.ts'

export const masterTempo: Feature = async ({ desk, controller, view, signal }) => {
  for (const i of DECKS) showMasterTempo(view.decks[i], desk.decks[i], controller === null, signal)
  const hardware = controller === null ? [] : DECKS.flatMap((i) => playMasterTempo(controller.decks[i], desk.decks[i], signal))
  try {
    await Promise.all([...DECKS.map((i) => keepKeyLock(desk.decks, i, signal)), ...hardware])
  } catch (err) {
    throw new Error('master tempo stopped', { cause: err })
  }
}
