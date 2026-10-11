// Concern: the Beat FX unit as rekordbox plays it on a DDJ-FLX10: effect, target, steps, ON, depth, AUTO/TAP, Release FX, BPM, display | Non-concern: the audio, the buttons | IO: (state, press) -> state
import type { DeckIndex, Pair } from '../../shared/decks.ts'
import { BEATS } from '../../shared/fx/beats.ts'
import { beatSeconds } from '../../shared/fx/dsp.ts'
import { DELAY_SECONDS, RING_SECONDS } from '../../shared/fx/messages.ts'
import { tapped, tappedBpm, type Taps } from '../../shared/tap.ts'
import { DEFAULTS, EFFECTS, KINDS, LISTS, NAMES, paramText, TARGET_LABELS, TARGETS, type BeatFx, type ReleaseFx, type Target } from './effects.ts'

export type BpmMode = 'auto' | 'tap'

export type Release = { readonly type: ReleaseFx; readonly beats: number; readonly held: boolean }

export type BeatFxState = {
  readonly effect: BeatFx
  readonly target: Target
  readonly on: boolean
  readonly depth: number
  readonly params: Readonly<Record<BeatFx, number>>
  readonly mode: BpmMode
  readonly taps: Taps
  readonly tapBpm: number
  readonly release: Release
}

// sysex-crack.md §2: what rekordbox writes with no track loaded.
export const NO_TRACK_BPM = 120

// ASSUMPTION: ECHO 1 as Release FX; the rest is the knobs'.
export const START: BeatFxState = {
  effect: 'trans',
  target: 'master',
  on: false,
  depth: 0.5,
  // fromEntries types its keys as strings; EFFECTS names every BeatFx.
  params: Object.fromEntries(EFFECTS.map((e) => [e, DEFAULTS[KINDS[e]]])) as Record<BeatFx, number>,
  mode: 'auto',
  taps: [],
  tapBpm: NO_TRACK_BPM,
  release: { type: 'releaseEcho', beats: 1, held: false },
}

export const selected = (s: BeatFxState, effect: BeatFx): BeatFxState => (s.effect === effect ? s : { ...s, effect })

export const targeted = (s: BeatFxState, target: Target): BeatFxState => (s.target === target ? s : { ...s, target })

// MAN p.93 step 5.
export const toggled = (s: BeatFxState): BeatFxState => ({ ...s, on: !s.on })

// MAN pp.54-55 items 3-4. ASSUMPTION: no wrap.
export function stepped(s: BeatFxState, direction: -1 | 1): BeatFxState {
  const list = LISTS[KINDS[s.effect]]
  const at = list.indexOf(s.params[s.effect])
  if (at < 0) throw new RangeError(`${NAMES[s.effect]} holds ${s.params[s.effect]}, which is not on its list`)
  const value = list[Math.min(list.length - 1, Math.max(0, at + direction))]
  return value === s.params[s.effect] ? s : { ...s, params: { ...s.params, [s.effect]: value } }
}

export function depthSet(s: BeatFxState, depth: number): BeatFxState {
  if (!(depth >= 0 && depth <= 1)) throw new RangeError(`LEVEL/DEPTH runs from 0 to 1, not ${depth}`)
  return depth === s.depth ? s : { ...s, depth }
}

// MAN p.54 item 3.
export const automatic = (s: BeatFxState): BeatFxState => (s.mode === 'auto' ? s : { ...s, mode: 'auto', taps: [] })

// MAN p.55 item 4. ASSUMPTION: the press entering TAP is its first tap; the BPM holds until taps give one.
export function tappedAt(s: BeatFxState, time: number, bpm: number): BeatFxState {
  if (s.mode === 'auto') return { ...s, mode: 'tap', taps: [time], tapBpm: bpm }
  const taps = tapped(s.taps, time)
  return { ...s, taps, tapBpm: tappedBpm(taps) ?? s.tapBpm }
}

/** BEAT ◀ (-1) or ▶ (1): SHIFT sets AUTO or taps (MAN pp.54-55); else a step, none while a PAD FX pad holds the press (RB p.189). */
export function beatPressed(s: BeatFxState, direction: -1 | 1, shift: boolean, time: number, bpm: number, padsHeld: number): BeatFxState {
  if (shift) return direction < 0 ? automatic(s) : tappedAt(s, time, bpm)
  return padsHeld > 0 ? s : stepped(s, direction)
}

// RB p.185: the Release FX cancels the Beat FX and acts while held.
export const releaseHeld = (s: BeatFxState, held: boolean): BeatFxState => ({ ...s, on: held ? false : s.on, release: { ...s.release, held } })

export type BpmSources = { readonly decks: Pair<number | null>; readonly sampler: number; readonly master: DeckIndex }

// RB p.185 [AUTO]; RB p.182 [S], [M]. The demo has no CH 3, CH 4 or microphone.
export function fxBpm(s: BeatFxState, from: BpmSources): number {
  if (s.mode === 'tap') return s.tapBpm
  switch (s.target) {
    case 'channel1':
      return from.decks[0] ?? NO_TRACK_BPM
    case 'channel2':
      return from.decks[1] ?? NO_TRACK_BPM
    case 'sampler':
      return from.sampler
    case 'master':
      return from.decks[from.master] ?? NO_TRACK_BPM
    case 'channel3':
    case 'channel4':
    case 'mic':
      return NO_TRACK_BPM
  }
}

export function phaseOf(s: BeatFxState, master: DeckIndex): 'tap' | DeckIndex | null {
  if (s.mode === 'tap') return 'tap'
  if (s.target === 'channel1') return 0
  if (s.target === 'channel2') return 1
  return s.target === 'master' || s.target === 'sampler' ? master : null
}

export const activeOf = (s: BeatFxState): { readonly effect: BeatFx; readonly value: number } | null => (s.on && !s.release.held ? { effect: s.effect, value: s.params[s.effect] } : null)

const RING: ReadonlySet<string> = new Set(['roll', 'slipRoll', 'stretch', 'vBrake', 'backSpin'])
const DELAYED: Readonly<Record<string, number>> = { lowCutEcho: 1, echo: 1, spiral: 1, mtDelay: 7 / 8, releaseEcho: 1 }

function overrun(name: string, kind: string, beats: number, bpm: number): string | null {
  const seconds = beats * beatSeconds(bpm)
  const ring = RING.has(kind)
  const limit = ring ? RING_SECONDS : DELAY_SECONDS
  if (!ring && !(kind in DELAYED)) return null
  const asked = ring ? seconds : seconds * DELAYED[kind]
  if (asked <= limit) return null
  return `${name} at ${beats} beats and ${bpm.toFixed(1)} BPM needs ${asked.toFixed(1)} s, past the ${limit} s ${ring ? 'of sound the effect processor keeps' : 'a delay line holds'}`
}

export function refusal(s: BeatFxState, bpm: number): string | null {
  if (!(bpm > 0)) return null
  return overrun(NAMES[s.effect], s.effect, Math.abs(s.params[s.effect]), bpm) ?? overrun(`Release FX ${s.release.type}`, s.release.type, s.release.beats, bpm)
}

/** What the effects section display shows (MAN p.92), as sysex-crack.md §2 would carry it: `bpm` in hundredths. */
export type Display = { readonly name: string; readonly parameter: string; readonly bpm: number; readonly mode: 'AUTO' | 'TAP'; readonly channel: string }

export const displayOf = (s: BeatFxState, bpm: number): Display => ({
  name: NAMES[s.effect],
  parameter: paramText(KINDS[s.effect], s.params[s.effect]),
  bpm: Math.round(bpm * 100),
  mode: s.mode === 'auto' ? 'AUTO' : 'TAP',
  channel: TARGET_LABELS[s.target],
})
