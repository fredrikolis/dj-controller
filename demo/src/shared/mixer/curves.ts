// Concern: what a mixer control's position from 0 to 1 means: EQ gain, channel fader gain, equal-power crossfader gain by assign | Non-concern: applying them (mixer.ts) | IO: (position) -> number
export type Assign = 'a' | 'thru' | 'b'

export const ASSIGNS: readonly Assign[] = ['a', 'thru', 'b']

// A DJ mixer's isolator, an assumption of this demo: full kill at 0, -26 dB just above, +6 dB at the top.
const EQ_KILL_DB = -40
const EQ_CUT_DB = -26
const EQ_BOOST_DB = 6

export function eqDb(position: number): number {
  if (position <= 0) return EQ_KILL_DB
  return position < 0.5 ? EQ_CUT_DB * (1 - position / 0.5) : (EQ_BOOST_DB * (position - 0.5)) / 0.5
}

export const faderGain = (position: number): number => position * position

/** Equal power: the two sides' gains squared sum to 1 across the travel; thru ignores the crossfader. */
export function crossfaderGain(position: number, assign: Assign): number {
  if (assign === 'thru') return 1
  const angle = (position * Math.PI) / 2
  return assign === 'a' ? Math.cos(angle) : Math.sin(angle)
}
