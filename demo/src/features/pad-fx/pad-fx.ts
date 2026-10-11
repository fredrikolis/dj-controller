// Concern: the PAD FX feature: each deck's two banks of 16 effects held on its pads from the page or the FLX10, rendered on its channel | Non-concern: the rules, the audio | IO: (FeatureHandles) -> fx
import './pad-fx.css'
import { DECKS } from '../../shared/decks.ts'
import { registerFx } from '../../shared/fx/processor.ts'
import type { Feature } from '../../shared/feature.ts'
import { frames } from '../../shared/frames.ts'
import { createStore } from '../../shared/store.ts'
import { startPadFx, type DeckFx } from './actions.ts'
import { playBeatButtons, playPadFx, type Shown } from './hardware.ts'
import { showPadFx, showPadFxDisplay } from './screen.ts'

async function keepTime(fxs: readonly DeckFx[], signal: AbortSignal): Promise<void> {
  for await (const _ of frames(signal)) for (const fx of fxs) fx.tick()
}

export const padFx: Feature = async ({ desk, controller, shifts, view, signal }) => {
  try {
    await registerFx(desk.context)
    if (signal.aborted) return
    const fxs = DECKS.map((i) => startPadFx(desk, i, signal))
    if (controller === null) {
      await Promise.all([keepTime(fxs, signal), ...DECKS.map((i) => showPadFx(view.decks[i], fxs[i], shifts[i], signal))])
      return
    }
    const shown = DECKS.map(() => createStore<Shown>(null))
    await Promise.all([
      keepTime(fxs, signal),
      ...DECKS.map((i) => showPadFxDisplay(view.decks[i], fxs[i], shown[i], signal)),
      ...DECKS.flatMap((i) => playPadFx(controller.decks[i], fxs[i], shown[i], signal)),
      ...playBeatButtons(controller, fxs, signal),
    ])
  } catch (err) {
    throw new Error('the PAD FX stopped', { cause: err })
  }
}
