// Concern: what a deck's hot cues light: each cue its own colour, a hot loop amber, the called blinking, PAGE LEDs, as a plan | Non-concern: writing it | IO: (deck) -> plan
import type { Pattern } from 'dj-controller'
import type { Blink, ModeViews, Plan, Steady } from '../lights/show-lights.ts'
import { calledSlot, slotOf, type Cueing } from './hot-cue.ts'

// RB p.234 [COLORFUL]; rgb: mixxxdj/mixxx 0cf6f5a; pad: the model palette's nearest hue, unverified. ASSUMPTION: I-P alike.
export const COLORFUL = [
  { rgb: '#FF127B', pad: 53 },
  { rgb: '#50B4FF', pad: 13 },
  { rgb: '#A5E116', pad: 25 },
  { rgb: '#AA42FF', pad: 61 },
  { rgb: '#10B176', pad: 17 },
  { rgb: '#E0641B', pad: 37 },
  { rgb: '#305AFF', pad: 5 },
  { rgb: '#C3AF04', pad: 29 },
] as const
// RB p.234 [CDJ]; unverified.
export const LOOP_COLOUR = 33

export function cueColour(slot: number): number {
  const colour = COLORFUL[slot % COLORFUL.length]
  if (colour === undefined) throw new RangeError(`hot cue slot ${slot} has no colour: slots run from 0`)
  return colour.pad
}

// MML p.7 *1; flx10-connect.md frames 106-282.
export const EMPTY_COLOUR = 0
// ASSUMPTION: the loops' blink.
export const HOT_LOOP_BLINK: Pattern<number> = { steps: [[LOOP_COLOUR, 250], [127, 250]], repeat: true }

export type PadLight = { readonly colour: number; readonly blink: boolean }

export function padLightsOf(deck: Pick<Cueing, 'loop' | 'hotCues'>): readonly PadLight[] {
  const called = calledSlot(deck)
  return deck.hotCues.map((cue, slot) => ({ colour: cue === null ? EMPTY_COLOUR : cue.kind === 'cue' ? cueColour(slot) : LOOP_COLOUR, blink: slot === called }))
}

// ASSUMPTION: SHIFT mirrors.
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
