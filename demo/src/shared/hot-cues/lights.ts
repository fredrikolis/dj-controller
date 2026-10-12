// Concern: hot cue lights: a cue's colour, a hot loop amber, the called blinking | Non-concern: writing | IO: (deck) -> plan
import type { Pattern } from 'dj-controller'
import { padPlan, pageShowing, type PadLight } from '../lights/pad-lights.ts'
import type { ModeViews, Plan } from '../lights/show-lights.ts'
import { calledSlot, slotOf, type Cueing } from './hot-cue.ts'

// RB p.234 [COLORFUL]; rgb: mixxxdj/mixxx 0cf6f5a; pad: nearest hue, unverified. ASSUMPTION: I-P alike.
const COLORFUL = [
  { rgb: '#FF127B', pad: 53 },
  { rgb: '#50B4FF', pad: 13 },
  { rgb: '#A5E116', pad: 25 },
  { rgb: '#AA42FF', pad: 61 },
  { rgb: '#10B176', pad: 17 },
  { rgb: '#E0641B', pad: 37 },
  { rgb: '#305AFF', pad: 5 },
  { rgb: '#C3AF04', pad: 29 },
] as const

// MML p.7 *1; flx10-connect.md frames 106-282.
const EMPTY_COLOUR = 0
// RB p.234 [CDJ], unverified. ASSUMPTION: the blink.
const LOOP_COLOUR = 33
const HOT_LOOP_BLINK: Pattern<number> = { steps: [[LOOP_COLOUR, 250], [127, 250]], repeat: true }

const cueColour = (slot: number): number => COLORFUL[slot % COLORFUL.length].pad

export function hotCueLight(deck: Pick<Cueing, 'loop' | 'hotCues'>): (page: number, pad: number) => PadLight {
  const called = calledSlot(deck)
  return (page, pad) => {
    const slot = slotOf(page, pad)
    const cue = deck.hotCues[slot]
    if (slot === called) return HOT_LOOP_BLINK
    return cue === null ? EMPTY_COLOUR : cue.kind === 'cue' ? cueColour(slot) : LOOP_COLOUR
  }
}

export function planOf(views: ModeViews, deck: Pick<Cueing, 'loop' | 'hotCues'>, page: number | null): Plan {
  return padPlan([{ views, light: hotCueLight(deck), leds: pageShowing(page) }])
}
