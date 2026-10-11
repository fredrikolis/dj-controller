// Concern: the BEAT FX feature: rekordbox's FX1 unit played from the FLX10's effects section or the page, rendered on its target | Non-concern: the rules, the audio | IO: (FeatureHandles) -> unit
import './beat-fx.css'
import type { Feature } from '../../shared/feature.ts'
import { frames } from '../../shared/frames.ts'
import { registerFx } from '../../shared/fx/processor.ts'
import { startBeatFx, type BeatFxControls } from './actions.ts'
import { playBeatFx, stateOf } from './hardware.ts'
import { showBeatFx } from './screen.ts'
import { startFrom } from './unit-state.ts'

async function keepTime(fx: BeatFxControls, signal: AbortSignal): Promise<void> {
  for await (const _ of frames(signal)) fx.tick()
}

/** Unconnected from `start`, `?fx=`'s parts; connected as the FLX10's knobs stand. */
export const beatFx = (start: readonly string[] | null): Feature => async ({ desk, controller, shifts, view, signal }) => {
  try {
    await registerFx(desk.context)
    if (signal.aborted) return
    const fx = startBeatFx(desk, controller === null ? startFrom(start ?? []) : stateOf(controller), signal)
    showBeatFx(view.effects, fx, shifts, signal)
    await Promise.all([keepTime(fx, signal), ...(controller === null ? [] : playBeatFx(controller, fx, signal))])
  } catch (err) {
    throw new Error('the Beat FX stopped', { cause: err })
  }
}
