// Concern: the SAMPLER feature: the sampler deck played from the FLX10's pads in Sampler mode, each slot's name and the bank on the twin | Non-concern: the rules, the audio | IO: handles -> sampler deck
import { DECKS } from '../../shared/decks.ts'
import type { Feature } from '../../shared/feature.ts'
import type { Flx10 } from '../../shared/flx10.ts'
import { positionOf, slotAt } from '../../shared/sampler/banks.ts'
import type { SamplerState } from '../../shared/sampler/sampler-state.ts'
import type { Watched } from '../../shared/store.ts'
import { until } from '../../shared/streams.ts'
import type { TwinText } from '../../shared/twin-text.ts'
import { samplerOf } from './actions.ts'
import { playSampler } from './hardware.ts'

// MAN p.83 step 2: PAGE steps the bank.
function showSlots(text: TwinText, controller: Flx10, state: Watched<SamplerState>, signal: AbortSignal): void {
  state.watch(({ bank }) => {
    for (const deck of DECKS) {
      const controls = controller.decks[deck]
      text.label(controls.padMode.sampler, `SAMPLER ${bank + 1}`)
      text.labelPads(controls.modes.sampler, (_, pad) => slotAt(bank, positionOf(deck, pad))?.name)
    }
  }, signal)
}

// BPM, BPM SYNC, Q and GAIN keep their defaults: the FLX10 has no control for them (MAN pp.83-84).
export const sampler: Feature = async ({ desk, controller, text, signal }) => {
  try {
    const s = samplerOf(desk.sampler)
    showSlots(text, controller, desk.sampler.state, signal)
    await Promise.all([until(desk.sampler.done, signal), ...playSampler(controller, s, signal)])
  } catch (err) {
    throw new Error('the sampler stopped', { cause: err })
  }
}
