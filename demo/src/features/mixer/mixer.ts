// Concern: the mixer feature: EQ, channel faders, equal-power crossfader with assigns, fader start, from the page or the FLX10 | Non-concern: the audio graph | IO: (FeatureHandles) -> mix, DOM, outputs
import './mixer.css'
import type { Feature } from '../../shared/feature.ts'
import { playMixer } from './hardware.ts'
import { showMixer } from './screen.ts'

export const mixer: Feature = async ({ desk, controller, shifts, view, signal }) => {
  if (controller === null) return showMixer(view.mixer, desk.mixer, desk.decks, shifts, signal)
  try {
    await Promise.all(playMixer(controller, desk.mixer, desk.decks, signal))
  } catch (err) {
    throw new Error('the mixer stopped', { cause: err })
  }
}
