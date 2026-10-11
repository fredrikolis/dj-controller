// Concern: the SAMPLER feature: the sampler deck played from the FLX10's pads in Sampler mode or the page | Non-concern: the rules, the audio | IO: (FeatureHandles) -> sampler deck
import './sampler.css'
import type { Feature } from '../../shared/feature.ts'
import { until } from '../../shared/streams.ts'
import { samplerOf } from './actions.ts'
import { playSampler } from './hardware.ts'
import { showSamplerDeck, showSamplerVolume } from './screen.ts'

export const sampler: Feature = async ({ desk, controller, shifts, view, signal }) => {
  try {
    const s = samplerOf(desk.sampler)
    if (controller === null) showSamplerVolume(view.mixer, s, signal)
    const playing = controller === null ? [] : playSampler(controller, s, signal)
    // The sounds render for the page's life, this feature until its signal: it must settle then, or a connect never takes over.
    await Promise.all([until(desk.sampler.done, signal), showSamplerDeck(view.sampler, s, shifts, signal), ...playing])
  } catch (err) {
    throw new Error('the sampler stopped', { cause: err })
  }
}
