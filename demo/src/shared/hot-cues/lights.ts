// Concern: what a deck's hot cues light: each slot's pad colour from the model palette, the called hot loop's blink, PAGE LEDs, as a plan | Non-concern: writing it (shared/lights) | IO: (deck) -> plan
import type { Pattern } from 'dj-controller'
import type { Blink, ModeViews, Plan, Steady } from '../lights/show-lights.ts'
import { calledSlot, slotOf, type Cueing } from './hot-cue.ts'

// RB p.234; unverified.
export const CUE_COLOUR = 21
export const LOOP_COLOUR = 37
// MML p.7 *1; flx10-connect.md frames 106-282.
export const EMPTY_COLOUR = 0
// ASSUMPTION: the loops' blink.
export const HOT_LOOP_BLINK: Pattern<number> = { steps: [[LOOP_COLOUR, 250], [127, 250]], repeat: true }

export type PadLight = { readonly colour: number; readonly blink: boolean }

export function padLightsOf(deck: Pick<Cueing, 'loop' | 'hotCues'>): readonly PadLight[] {
  const called = calledSlot(deck)
  return deck.hotCues.map((cue, slot) => ({ colour: cue === null ? EMPTY_COLOUR : cue.kind === 'cue' ? CUE_COLOUR : LOOP_COLOUR, blink: slot === called }))
}

// ASSUMPTION: SHIFT mirrors; PAGE lit as shown.
export function planOf(views: ModeViews, lights: readonly PadLight[], page: number | null): Plan {
  const steady: Steady[] = []
  const blinks: Blink[] = []
  views.pages.forEach(({ pads, shifted }, p) => {
    for (const [layer, outs] of [['plain', pads], ['shifted', shifted]] as const) {
      outs.forEach((out, i) => {
        const light = lights[slotOf(p, i)]
        if (light.blink) blinks.push({ kind: 'pad', name: `hot cue ${p} ${i} ${layer}`, out, pattern: HOT_LOOP_BLINK })
        else steady.push({ kind: 'pad', out, value: light.colour })
      })
    }
  })
  if (page !== null) steady.push({ kind: 'led', out: views.left, value: page === 0 }, { kind: 'led', out: views.right, value: page === 1 })
  return { steady, blinks }
}
