// Concern: the BEAT FX feature: rekordbox's FX1 unit played from the FLX10's effects section, its display on the twin's | Non-concern: the rules, the audio | IO: (FeatureHandles) -> unit
import type { Feature } from '../../shared/feature.ts'
import { frames } from '../../shared/frames.ts'
import { registerFx } from '../../shared/fx/processor.ts'
import type { TwinText } from '../../shared/twin-text.ts'
import { startBeatFx, type BeatFxControls } from './actions.ts'
import { playBeatFx, stateOf } from './hardware.ts'
import { displayOf } from './unit-state.ts'

async function keepTime(fx: BeatFxControls, signal: AbortSignal): Promise<void> {
  for await (const _ of frames(signal)) fx.tick()
}

function showDisplay(text: TwinText, fx: BeatFxControls, signal: AbortSignal): void {
  const show = () => {
    const { name, parameter, bpm, mode } = displayOf(fx.state.state, fx.bpm.state)
    text.show('beatFx', { name, beat: parameter, bpm: bpm / 100, tap: mode === 'TAP' })
  }
  fx.state.watch(show, signal)
  fx.bpm.watch(show, signal)
}

// The Release FX keeps its default type and beats: the FLX10 has no control for either (MAN p.55).
export const beatFx: Feature = async ({ desk, controller, text, signal }) => {
  try {
    await registerFx(desk.context)
    if (signal.aborted) return
    const fx = startBeatFx(desk, stateOf(controller), signal)
    showDisplay(text, fx, signal)
    await Promise.all([keepTime(fx, signal), ...playBeatFx(controller, fx, signal)])
  } catch (err) {
    throw new Error('the Beat FX stopped', { cause: err })
  }
}
