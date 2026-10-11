// Concern: what the Beat FX section lights: BEAT FX ON/OFF blinking while on, its SHIFT layer while the Release FX is held, as a plan | Non-concern: writing it | IO: (state) -> plan
import type { Pattern } from 'dj-controller'
import type { Output, Plan } from '../../shared/lights/show-lights.ts'
import type { BeatFxState } from './unit-state.ts'

export type Lights = { readonly onOff: Output<boolean>; readonly release: Output<boolean> }

// MAN p.93 step 5: it flashes while on. ASSUMPTION: the loops' blink.
export const ON_BLINK: Pattern<boolean> = { steps: [[true, 250], [false, 250]], repeat: true }

// ASSUMPTION: the SHIFT layer's LED lit while the Release FX is held.
export function planOf(lights: Lights, s: BeatFxState): Plan {
  const release = { kind: 'led', out: lights.release, value: s.release.held } as const
  if (!s.on) return { steady: [{ kind: 'led', out: lights.onOff, value: false }, release], blinks: [] }
  return { steady: [release], blinks: [{ kind: 'led', name: 'beat-fx-on', out: lights.onOff, pattern: ON_BLINK }] }
}
