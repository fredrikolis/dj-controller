// Concern: the demo's two PAD FX banks: 32 slots A to AF over two modes' pages, each an effect at its beats or size | Non-concern: holding, rendering | IO: (bank, page, pad) -> slot
import { beatsText } from '../../shared/fx/beats.ts'
import type { BufferEffect } from '../../shared/fx/messages.ts'

export type Effect = 'echo' | 'lowCutEcho' | 'dubEcho' | 'reverb' | 'trans' | 'flanger' | 'phaser' | 'roll' | 'revRoll' | 'lpf' | 'hpf' | 'crush' | 'releaseEcho' | 'vBrake' | 'backSpin'

/** Beats from the Beat FX list, a size in percent, or neither. */
export type Timing = { readonly beats: number } | { readonly percent: number } | null

export type Slot = { readonly letter: string; readonly effect: Effect; readonly timing: Timing }

// RB p.189 (Release FX), p.210 (V.BRAKE).
export const RELEASE_FX: ReadonlySet<Effect> = new Set(['releaseEcho', 'vBrake', 'backSpin'])

export const isBufferEffect = (effect: Effect): effect is Effect & BufferEffect => effect === 'roll' || effect === 'revRoll' || effect === 'vBrake' || effect === 'backSpin'

export const NAMES: Readonly<Record<Effect, string>> = {
  echo: 'ECHO',
  lowCutEcho: 'LOW CUT ECHO',
  dubEcho: 'DUB ECHO',
  reverb: 'REVERB',
  trans: 'TRANS',
  flanger: 'FLANGER',
  phaser: 'PHASER',
  roll: 'ROLL',
  revRoll: 'REV ROLL',
  lpf: 'FILTER LPF',
  hpf: 'FILTER HPF',
  crush: 'CRUSH',
  releaseEcho: 'RELEASE ECHO',
  vBrake: 'V.BRAKE',
  backSpin: 'BACK SPIN',
}

type Preset = readonly [Effect, Timing]

const b = (beats: number): Timing => ({ beats })

// ASSUMPTION: neither manual publishes rekordbox's presets (RB p.188); MAN p.81 has a Release FX assigned "in advance", so only mode 2 page 2 holds them.
const PRESETS: readonly Preset[] = [
  ['echo', b(1 / 2)], ['echo', b(3 / 4)], ['lowCutEcho', b(1)], ['reverb', { percent: 60 }], ['trans', b(1 / 4)], ['trans', b(1 / 8)], ['roll', b(1 / 4)], ['roll', b(1 / 8)],
  ['flanger', b(16)], ['phaser', b(8)], ['lpf', null], ['hpf', null], ['crush', null], ['dubEcho', b(1 / 2)], ['roll', b(1 / 2)], ['roll', b(1)],
  ['echo', b(1)], ['echo', b(1 / 4)], ['revRoll', b(1 / 2)], ['revRoll', b(1 / 4)], ['dubEcho', b(3 / 4)], ['phaser', b(16)], ['roll', b(1 / 16)], ['echo', b(2)],
  ['releaseEcho', b(1)], ['releaseEcho', b(2)], ['vBrake', b(1)], ['vBrake', b(4)], ['backSpin', b(1)], ['backSpin', b(2)], ['trans', b(1 / 2)], ['lowCutEcho', b(1 / 2)],
]

const letterOf = (index: number): string => (index < 26 ? String.fromCharCode(65 + index) : `A${String.fromCharCode(65 + index - 26)}`)

export const SLOTS: readonly Slot[] = PRESETS.map(([effect, timing], i) => ({ letter: letterOf(i), effect, timing }))

/** MAN p.80: mode 1 page 1 pads 1-8 are A-H, page 2 I-P; p.81: mode 2 Q-X, Y-AF. */
export const slotAt = (bank: number, page: number, pad: number): number => bank * 16 + page * 8 + pad

export const slotOf = (index: number): Slot => SLOTS[index]

export const timingText = (timing: Timing): string => (timing === null ? '' : 'beats' in timing ? beatsText(timing.beats) : `${timing.percent}%`)
