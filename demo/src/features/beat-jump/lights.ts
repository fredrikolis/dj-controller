// Concern: what a deck's beat-jump pads light: each pad's colour as rekordbox paints it, PAGE lit for the page showing | Non-concern: the plan's shape, writing it (shared/lights) | IO: (page) -> plan
import { padPlan, pageShowing } from '../../shared/lights/pad-lights.ts'
import type { ModeViews, Plan } from '../../shared/lights/show-lights.ts'

// flx10-connect.md frames 294-321; ASSUMPTION: page 2's pads 7 and 8 as page 1's.
const PAD_COLOURS: readonly number[] = [0x6a, 0x6a, 0x65, 0x65, 0x65, 0x65, 0x6a, 0x6a]

// ASSUMPTION: PAGE lit for the page showing.
export const planOf = (views: ModeViews, page: number | null): Plan => padPlan([{ views, light: (_, pad) => PAD_COLOURS[pad], leds: pageShowing(page) }])
