// Concern: the memory cues feature: each deck's memory cues and loops from the FLX10's CUE/LOOP CALL, Active Loops engaged | Non-concern: the rules (shared/memory-cues) | IO: (FeatureHandles) -> decks
import { DECKS } from '../../shared/decks.ts'
import type { Feature } from '../../shared/feature.ts'
import { keepActiveLoops } from './active-loops.ts'
import { playMemoryCues } from './hardware.ts'

export const memoryCues: Feature = async ({ desk, controller, signal }) => {
  try {
    await Promise.all([...DECKS.map((i) => keepActiveLoops(desk.decks[i], signal)), ...DECKS.flatMap((i) => playMemoryCues(controller.decks[i], desk.decks[i], signal))])
  } catch (err) {
    throw new Error('the memory cues stopped', { cause: err })
  }
}
