// Concern: the FLX10's 14 Beat FX and 7 targets as rekordbox names them: positions, lists, texts, each target's point, Release FX types | Non-concern: the rules, the audio | IO: (effect, value) -> text
import type { Pair } from '../../shared/decks.ts'
import { BEATS, beatsText } from '../../shared/fx/beats.ts'

// MML F13, in order.
export const EFFECTS = ['lowCutEcho', 'echo', 'mtDelay', 'spiral', 'reverb', 'trans', 'enigmaJet', 'flanger', 'phaser', 'stretch', 'slipRoll', 'roll', 'mobiusSaw', 'mobiusTri'] as const

export type BeatFx = (typeof EFFECTS)[number]

// MAN pp.94-98, MML F13.
export const NAMES: Readonly<Record<BeatFx, string>> = {
  lowCutEcho: 'LOW CUT ECHO',
  echo: 'ECHO',
  mtDelay: 'MT DELAY',
  spiral: 'SPIRAL',
  reverb: 'REVERB',
  trans: 'TRANS',
  enigmaJet: 'ENIGMA JET',
  flanger: 'FLANGER',
  phaser: 'PHASER',
  stretch: 'STRETCH',
  slipRoll: 'SLIP ROLL',
  roll: 'ROLL',
  mobiusSaw: 'MOBIUS (SAW)',
  mobiusTri: 'MOBIUS (TRI)',
}

export type ParamKind = 'beats' | 'rate' | 'signed' | 'percent'

export const KINDS: Readonly<Record<BeatFx, ParamKind>> = {
  lowCutEcho: 'beats',
  echo: 'beats',
  mtDelay: 'beats',
  spiral: 'beats',
  reverb: 'percent',
  trans: 'beats',
  enigmaJet: 'signed',
  flanger: 'rate',
  phaser: 'rate',
  stretch: 'beats',
  slipRoll: 'beats',
  roll: 'beats',
  mobiusSaw: 'signed',
  mobiusTri: 'signed',
}

const RATES = [...BEATS, 32, 64]

// MAN pp.94-98. ASSUMPTION: the steps.
export const LISTS: Readonly<Record<ParamKind, readonly number[]>> = {
  beats: BEATS,
  rate: RATES,
  signed: [...RATES.map((r) => -r).reverse(), ...RATES],
  percent: [1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
}

// ASSUMPTION: TRANS at "1" at connect (sysex-crack.md §2).
export const DEFAULTS: Readonly<Record<ParamKind, number>> = { beats: 1, rate: 1, signed: 1, percent: 50 }

// MAN p.92 item 5.
export function paramText(kind: ParamKind, value: number): string {
  if (!LISTS[kind].includes(value)) throw new RangeError(`${value} is not on the ${kind} list of a Beat FX parameter (MAN pp.94-98)`)
  if (kind === 'percent') return `${value}%`
  if (kind === 'signed') return `${value > 0 ? '+' : '-'}${beatsText(Math.abs(value))}`
  return beatsText(value)
}

// MML F14, in order.
export const TARGETS = ['channel1', 'channel2', 'channel3', 'channel4', 'master', 'mic', 'sampler'] as const

export type Target = (typeof TARGETS)[number]

// MAN p.92 item 4.
export const TARGET_LABELS: Readonly<Record<Target, string>> = { channel1: 'CH 1', channel2: 'CH 2', channel3: 'CH 3', channel4: 'CH 4', master: 'MST', mic: 'MIC', sampler: 'SP' }

// MAN p.93 step 3: MIC takes the unit's own effect; the demo has no CH 3, CH 4 or microphone.
export function pointFor<P>(points: { readonly channels: Pair<P>; readonly sampler: P; readonly master: P }, target: Target): P | null {
  switch (target) {
    case 'channel1':
      return points.channels[0]
    case 'channel2':
      return points.channels[1]
    case 'sampler':
      return points.sampler
    case 'master':
      return points.master
    case 'channel3':
    case 'channel4':
    case 'mic':
      return null
  }
}

// MAN pp.94-97.
export const BALANCED: ReadonlySet<BeatFx> = new Set(['lowCutEcho', 'echo', 'mtDelay', 'spiral', 'reverb', 'slipRoll', 'roll'])

// RB p.185, p.189, p.210.
export const RELEASES = ['releaseEcho', 'vBrake', 'backSpin'] as const

export type ReleaseFx = (typeof RELEASES)[number]

export const RELEASE_NAMES: Readonly<Record<ReleaseFx, string>> = { releaseEcho: 'ECHO', vBrake: 'V.BRAKE', backSpin: 'BACK SPIN' }
