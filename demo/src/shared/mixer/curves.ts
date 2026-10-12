// Concern: a mixer control's position as gain: TRIM, EQ, fader, crossfader by assign | Non-concern: applying them | IO: (position) -> number
export type Assign = 'a' | 'thru' | 'b'

export const ASSIGNS: readonly Assign[] = ['a', 'thru', 'b']

// MAN p.176; RB p.242 [EQ].
const EQ_CUT_DB = -26
const EQ_BOOST_DB = 6

export const eqDb = (position: number): number => (position < 0.5 ? EQ_CUT_DB * (1 - position / 0.5) : (EQ_BOOST_DB * (position - 0.5)) / 0.5)

// MAN p.73. ASSUMPTION: a DJM's.
const TRIM_TOP_DB = 9

export const trimGain = (position: number): number => (position < 0.5 ? (position / 0.5) ** 2 : 10 ** ((TRIM_TOP_DB * (position - 0.5)) / 0.5 / 20))

export const faderGain = (position: number): number => position * position

export function crossfaderGain(position: number, assign: Assign): number {
  if (assign === 'thru') return 1
  const angle = (position * Math.PI) / 2
  return assign === 'a' ? Math.cos(angle) : Math.sin(angle)
}
