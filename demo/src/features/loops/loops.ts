// Concern: the loops feature: each deck's quantize, manual, auto and pad loops, RELOOP and adjust, from the page or the FLX10 | Non-concern: the rules (loop.ts), the wrap | IO: (FeatureHandles) -> decks
import './loops.css'
import { DECKS } from '../../shared/decks.ts'
import type { Feature } from '../../shared/feature.ts'
import { adjustWithJogs } from './actions.ts'
import { playLoops } from './hardware.ts'
import { showLoops } from './screen.ts'

export const loops: Feature = async ({ desk, controller, shifts, view, signal }) => {
  for (const i of DECKS) adjustWithJogs(desk.decks[i], signal)
  const screens = DECKS.map((i) => showLoops(view.decks[i], desk.decks[i], shifts === null ? null : shifts[i], signal))
  const hardware = controller === null ? [] : DECKS.flatMap((i) => playLoops(controller.decks[i], desk.decks[i], signal))
  try {
    await Promise.all([...screens, ...hardware])
  } catch (err) {
    throw new Error('the loops stopped', { cause: err })
  }
}
