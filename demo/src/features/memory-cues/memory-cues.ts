// Concern: the memory cues feature: each deck's memory cues and loops from the page or the FLX10, Active Loops engaged | Non-concern: the rules (shared/memory-cues) | IO: (FeatureHandles) -> decks
import './memory-cues.css'
import { DECKS } from '../../shared/decks.ts'
import type { Feature } from '../../shared/feature.ts'
import { keepActiveLoops } from './active-loops.ts'
import { playMemoryCues } from './hardware.ts'
import { showMemoryCues } from './screen.ts'

export const memoryCues: Feature = async ({ desk, controller, shifts, view, signal }) => {
  for (const i of DECKS) showMemoryCues(view.decks[i], desk.decks[i], shifts === null ? null : shifts[i], signal)
  const engaging = DECKS.map((i) => keepActiveLoops(desk.decks[i], signal))
  const hardware = controller === null ? [] : DECKS.flatMap((i) => playMemoryCues(controller.decks[i], desk.decks[i], signal))
  try {
    await Promise.all([...engaging, ...hardware])
  } catch (err) {
    throw new Error('the memory cues stopped', { cause: err })
  }
}
