// Concern: what a deck's beat-jump pads light: both pages' colours as rekordbox paints them, the PAGE LEDs, as a plan | Non-concern: writing it (shared/lights) | IO: (page) -> plan
import type { ModeViews, Plan, Steady } from '../../shared/lights/show-lights.ts'

// flx10-connect.md frames 294-321; ASSUMPTION: page 2's pads 7 and 8 as page 1's.
export const PAD_COLOURS: readonly number[] = [0x6a, 0x6a, 0x65, 0x65, 0x65, 0x65, 0x6a, 0x6a]

const colourOf = (pad: number): number => {
  const colour = PAD_COLOURS[pad]
  if (colour === undefined) throw new RangeError(`no beat jump pad colour for pad ${pad}: the FLX10 has pads 0 to 7 (MML p.7 *1)`)
  return colour
}

// ASSUMPTION: PAGE lit for the page showing.
export function planOf(views: ModeViews, page: number | null): Plan {
  const steady: Steady[] = views.pages.flatMap(({ pads, shifted }) => [...pads.entries(), ...shifted.entries()].map(([i, out]): Steady => ({ kind: 'pad', out, value: colourOf(i) })))
  if (page !== null) steady.push({ kind: 'led', out: views.left, value: page === 0 }, { kind: 'led', out: views.right, value: page === 1 })
  return { steady, blinks: [] }
}
