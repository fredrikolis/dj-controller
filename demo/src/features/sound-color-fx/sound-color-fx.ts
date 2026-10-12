// Concern: the SOUND COLOR FX feature: rekordbox's six colour effects on channels 1 and 2 from the FLX10's buttons and COLOR knobs | Non-concern: the rules, the audio | IO: (FeatureHandles) -> units
import { DECKS } from '../../shared/decks.ts'
import type { Feature } from '../../shared/feature.ts'
import { registerFx } from '../../shared/fx/processor.ts'
import { createStore } from '../../shared/store.ts'
import { playingBpm } from '../../shared/transport/bpm.ts'
import { playColorFx, type ColorFxState } from './hardware.ts'
import { settingsOf } from './rules.ts'
import { createColorFxUnit } from './unit.ts'

// MAN p.99: no effect is selected until a button is pressed; the knobs stand where the controller reports them.
export const soundColorFx: Feature = async ({ desk, controller, signal }) => {
  try {
    await registerFx(desk.context)
    if (signal.aborted) return
    const state = createStore<ColorFxState>({ selected: null, colours: [0, 0] })
    for (const d of DECKS) {
      const unit = createColorFxUnit(desk.context, desk.mixer.colour[d], signal)
      const deck = desk.decks[d]
      const apply = () => unit.apply(settingsOf(state.state.selected, state.state.colours[d]), playingBpm(deck.state.state, deck.song.bpm))
      state.watch(apply, signal)
      deck.state.watch(apply, signal)
    }
    await Promise.all(playColorFx(controller, state, signal))
  } catch (err) {
    throw new Error('the Sound Color FX stopped', { cause: err })
  }
}
