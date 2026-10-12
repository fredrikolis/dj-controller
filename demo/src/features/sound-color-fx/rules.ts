// Concern: Sound Color FX as rekordbox plays them on a DDJ-FLX10: one effect for every channel, a COLOR knob each, what a turn asks | Non-concern: the audio, the buttons | IO: (press, knob) -> settings
export const EFFECTS = ['space', 'dubEcho', 'crush', 'pitch', 'noise', 'filter'] as const

export type ColorFx = (typeof EFFECTS)[number]

// MAN p.99.
export const pressed = (selected: ColorFx | null, effect: ColorFx): ColorFx | null => (selected === effect ? null : effect)

// ASSUMPTION: the centre detent's width.
const CENTRE = 0.03

/** From -1, fully counterclockwise, to 1. */
export function colourOf(position: number): number {
  if (!(position >= 0 && position <= 1)) throw new RangeError(`COLOR runs from 0 to 1, not ${position}`)
  const turn = 2 * position - 1
  return Math.abs(turn) <= CENTRE ? 0 : (Math.sign(turn) * (Math.abs(turn) - CENTRE)) / (1 - CENTRE)
}

const sweep = (from: number, to: number, amount: number): number => from * (to / from) ** amount

const OPEN = { lowpass: 20000, highpass: 10 } as const

/** Filters in Hz, levels from 0 to 1. */
export type Settings = {
  readonly lowpass: number
  readonly highpass: number
  readonly resonant: boolean
  readonly crush: number
  readonly pitch: number
  readonly noise: { readonly level: number; readonly lowpass: number; readonly highpass: number }
  readonly echo: { readonly send: number; readonly band: 'mid' | 'high' }
  readonly space: { readonly send: number; readonly band: 'low' | 'high' }
}

export const NONE: Settings = { ...OPEN, resonant: false, crush: 0, pitch: 1, noise: { level: 0, ...OPEN }, echo: { send: 0, band: 'mid' }, space: { send: 0, band: 'low' } }

// MAN pp.99-101. ASSUMPTION: how far each goes.
export function settingsOf(effect: ColorFx | null, colour: number): Settings {
  if (!(colour >= -1 && colour <= 1)) throw new RangeError(`a COLOR turn runs from -1 to 1, not ${colour}`)
  const amount = Math.abs(colour)
  if (effect === null || amount === 0) return NONE
  const up = colour > 0
  switch (effect) {
    case 'filter':
      return { ...NONE, resonant: true, ...(up ? { highpass: sweep(20, 9000, amount) } : { lowpass: sweep(20000, 80, amount) }) }
    case 'crush':
      return { ...NONE, crush: amount, highpass: up ? sweep(20, 2500, amount) : OPEN.highpass }
    case 'pitch':
      return { ...NONE, pitch: 2 ** colour }
    case 'noise':
      return { ...NONE, noise: { level: amount, lowpass: up ? OPEN.lowpass : sweep(20000, 400, amount), highpass: up ? sweep(100, 12000, amount) : OPEN.highpass } }
    case 'dubEcho':
      return { ...NONE, echo: { send: amount, band: up ? 'high' : 'mid' } }
    case 'space':
      return { ...NONE, space: { send: amount, band: up ? 'high' : 'low' } }
  }
}
