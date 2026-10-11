// Concern: the mixer feature: EQ, channel faders, equal-power crossfader with assigns, fader start, from the FLX10 | Non-concern: the audio graph | IO: (FeatureHandles) -> mix, outputs
import type { Feature } from '../../shared/feature.ts'
import { playMixer } from './hardware.ts'

export const mixer: Feature = async ({ desk, controller, signal }) => {
  try {
    await Promise.all(playMixer(controller, desk.mixer, desk.decks, signal))
  } catch (err) {
    throw new Error('the mixer stopped', { cause: err })
  }
}
