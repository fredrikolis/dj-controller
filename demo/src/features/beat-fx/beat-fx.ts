// Concern: the BEAT FX feature: rekordbox's FX1 unit played from the FLX10's effects section, its display on the twin and the unit | Non-concern: the rules, the audio | IO: (FeatureHandles) -> unit
import type { BeatFxDisplay, ControllerError } from 'dj-controller'
import type { Feature } from '../../shared/feature.ts'
import { frames } from '../../shared/frames.ts'
import { logger } from '../../shared/logger.ts'
import { registerFx } from '../../shared/fx/processor.ts'
import type { TwinText } from '../../shared/twin-text.ts'
import { startBeatFx, type BeatFxControls } from './actions.ts'
import { playBeatFx, stateOf } from './hardware.ts'
import { displayOf, type Display } from './unit-state.ts'

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

// ASSUMPTION: a safe rate of display writes; none is known (docs/research/flx10-beat-fx-display.md).
const GAP_MS = 200

const refused = (err: unknown): err is ControllerError => err instanceof Error && err.name === 'ControllerError' && 'code' in err && err.code === 'refused'

// A tapped BPM can pass what the display's message carries: logged, and the unit keeps what it showed.
const unlessRefused = (write: Promise<void>): Promise<void> =>
  write.catch((err: unknown) => {
    if (!refused(err)) throw err
    logger.error('the FLX10 Beat FX display takes no such value', err)
  })

/** No unit has been seen drawing these. */
async function writeDisplay(out: BeatFxDisplay, shown: () => Display, signal: AbortSignal): Promise<void> {
  const told: { name?: string; parameter?: string; bpm?: number } = {}
  let wrote = -Infinity
  try {
    for await (const _ of frames(signal)) {
      if (performance.now() - wrote < GAP_MS) continue
      const { name, parameter, bpm } = shown()
      if (name === told.name && parameter === told.parameter && bpm === told.bpm) continue
      if (name !== told.name) await unlessRefused(out.name.set(name))
      if (parameter !== told.parameter) await unlessRefused(out.beat.set(parameter))
      if (bpm !== told.bpm) await unlessRefused(out.bpm.set(bpm / 100))
      Object.assign(told, { name, parameter, bpm })
      wrote = performance.now()
    }
  } catch (err) {
    if (!signal.aborted) throw err
  }
}

// The Release FX keeps its default type and beats: the FLX10 has no control for either (MAN p.55).
export const beatFx: Feature = async ({ desk, controller, text, signal }) => {
  try {
    await registerFx(desk.context)
    if (signal.aborted) return
    const fx = startBeatFx(desk, stateOf(controller), signal)
    showDisplay(text, fx, signal)
    const shown = () => displayOf(fx.state.state, fx.bpm.state)
    await Promise.all([keepTime(fx, signal), writeDisplay(controller.beatFxDisplay, shown, signal), ...playBeatFx(controller, fx, signal)])
  } catch (err) {
    throw new Error('the Beat FX stopped', { cause: err })
  }
}
