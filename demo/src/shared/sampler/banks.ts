// Concern: the demo's sampler deck: 4 banks of 16 slots, each an SVA sound with its play mode, kind and bars; a deck's pad as a position | Non-concern: playing them | IO: (bank, position) -> slot
/** RB p.197: Oneshot plays to its end, Loop repeats, Gate plays while held. */
export type PlayMode = 'oneshot' | 'loop' | 'gate'

export type Kind = 'drum' | 'stab' | 'fx' | 'loop'

/** `node` names its SVA file in demo/samples; a loop repeats `bars` bars of the sampler's BPM. */
export type Slot = { readonly name: string; readonly node: string; readonly mode: PlayMode; readonly kind: Kind; readonly bars: number | null }

// RB p.194 step 2: four banks of 16 slots.
export const BANKS = 4
export const POSITIONS = 16
export const PADS = 8

const shot = (name: string, node: string, kind: Kind): Slot => ({ name, node, mode: 'oneshot', kind, bars: null })
const gate = (name: string, node: string): Slot => ({ name, node, mode: 'gate', kind: 'fx', bars: null })
const loop = (name: string, node: string, bars: number): Slot => ({ name, node, mode: 'loop', kind: 'loop', bars })

// ASSUMPTION: the demo's sounds, in D minor at 144 BPM as the songs; bank 4 empty, as rekordbox fills a bank by SHIFT+pad (MAN p.83).
const DRUMS: readonly Slot[] = [
  ['Kick', 'kick'], ['Snare', 'snare'], ['Clap', 'clap'], ['Closed hat', 'hat'], ['Open hat', 'open-hat'], ['Rim', 'rim'], ['Crash', 'crash'], ['Ride', 'ride'],
  ['808', 'boom'], ['Low tom', 'tom-low'], ['Mid tom', 'tom-mid'], ['High tom', 'tom-high'], ['Shaker', 'shaker'], ['Cowbell', 'cowbell'], ['Snap', 'snap'], ['Clave', 'clave'],
].map(([name, node]) => shot(name, node, 'drum'))

const STABS_AND_FX: readonly Slot[] = [
  shot('Dm stab', 'stab-dm', 'stab'), shot('B♭ stab', 'stab-bb', 'stab'), shot('C stab', 'stab-c', 'stab'), shot('A stab', 'stab-a', 'stab'),
  shot('Organ stab', 'organ', 'stab'), shot('Brass stab', 'brass', 'stab'), shot('Bass stab', 'bass-stab', 'stab'), shot('Pluck chord', 'pluck-chord', 'stab'),
  gate('Riser', 'riser'), shot('Downlifter', 'downlifter', 'fx'), shot('Impact', 'impact', 'fx'), gate('Noise sweep', 'sweep'),
  shot('Laser', 'laser', 'fx'), shot('Air horn', 'air-horn', 'fx'), gate('Siren', 'siren'), shot('Reverse cymbal', 'reverse-cymbal', 'fx'),
]

const LOOPS: readonly Slot[] = [
  loop('Kick 4/4', 'loop-kick', 1), loop('Hats', 'loop-hats', 1), loop('Break', 'loop-break', 2), loop('Claps', 'loop-claps', 1),
  loop('Shaker', 'loop-shaker', 1), loop('Toms', 'loop-toms', 2), loop('Ride', 'loop-ride', 1), loop('Halftime', 'loop-halftime', 2),
  loop('Sub bass', 'loop-sub', 2), loop('Acid', 'loop-acid', 2), loop('Arp', 'loop-arp', 1), loop('Chord stabs', 'loop-chords', 2),
  loop('Pad', 'loop-pad', 4), loop('Pluck melody', 'loop-pluck', 2), loop('Chip lead', 'loop-chip', 2), loop('Offbeat bass', 'loop-offbeat', 1),
]

const SAMPLER_BANKS: readonly (readonly (Slot | null)[])[] = [DRUMS, STABS_AND_FX, LOOPS, Array.from({ length: POSITIONS }, () => null)]

export const SLOTS: readonly Slot[] = SAMPLER_BANKS.flat().filter((slot) => slot !== null)

export const slotAt = (bank: number, position: number): Slot | null => SAMPLER_BANKS[bank][position]

// MAN p.84: deck 1's pads play slots 1-8, deck 2's 9-16.
export const positionOf = (deck: number, pad: number): number => deck * PADS + pad
