// Concern: the PAD FX feature: each deck's two banks of 16 effects held on its pads from the FLX10, each pad's effect on the twin | Non-concern: the rules, the audio | IO: (FeatureHandles) -> fx
import { DECKS } from '../../shared/decks.ts'
import { registerFx } from '../../shared/fx/processor.ts'
import type { Feature } from '../../shared/feature.ts'
import type { Flx10Deck } from '../../shared/flx10.ts'
import { frames } from '../../shared/frames.ts'
import { createStore } from '../../shared/store.ts'
import type { TwinText } from '../../shared/twin-text.ts'
import { startPadFx, type DeckFx } from './actions.ts'
import { NAMES, slotAt, slotOf, timingText } from './banks.ts'
import { playBeatButtons, playPadFx, type Shown } from './hardware.ts'

async function keepTime(fxs: readonly DeckFx[], signal: AbortSignal): Promise<void> {
  for await (const _ of frames(signal)) for (const fx of fxs) fx.tick()
}

/** Each pad's effect and its beats or size, a held one's as BEAT ◀/▶ stepped it (RB p.189). */
function showNames(text: TwinText, controls: Flx10Deck, fx: DeckFx, signal: AbortSignal): void {
  const banks = [controls.modes.padFx1, controls.modes.padFx2]
  fx.holding.watch((holding) => {
    banks.forEach((mode, bank) =>
      text.labelPads(mode, (page, pad) => {
        const slot = slotAt(bank, page, pad)
        const { effect, timing } = slotOf(slot)
        return `${NAMES[effect]} ${timingText(holding.find((h) => h.on && h.slot === slot)?.timing ?? timing)}`.trim()
      }),
    )
  }, signal)
}

export const padFx: Feature = async ({ desk, controller, text, signal }) => {
  try {
    await registerFx(desk.context)
    if (signal.aborted) return
    const fxs = DECKS.map((i) => startPadFx(desk, i, signal))
    const shown = DECKS.map(() => createStore<Shown>(null))
    for (const i of DECKS) showNames(text, controller.decks[i], fxs[i], signal)
    await Promise.all([keepTime(fxs, signal), ...DECKS.flatMap((i) => playPadFx(controller.decks[i], fxs[i], shown[i], signal)), ...playBeatButtons(controller, fxs, signal)])
  } catch (err) {
    throw new Error('the PAD FX stopped', { cause: err })
  }
}
