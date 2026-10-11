// Concern: what a deck's KEY SHIFT and KEYBOARD pads light, the pitch asked brightest, hot cues while choosing, PAGE LEDs; the jog screen's key | Non-concern: writing them | IO: (deck, page) -> plan
import { MAX_SEMITONES } from '../../shared/engine/shift.ts'
import { padLightsOf, planOf as hotCuePlan } from '../../shared/hot-cues/lights.ts'
import type { ModeViews, Plan, Steady } from '../../shared/lights/show-lights.ts'
import type { DeckState } from '../../shared/transport/deck-state.ts'
import { keyName, keyOffset, movedBy, type Key } from '../../shared/transport/key.ts'
import { pitchOf } from './semitones.ts'

export type PitchKind = 'zero' | 'up' | 'down'

export const pitchKind = (pitch: number): PitchKind => (pitch === 0 ? 'zero' : pitch > 0 ? 'up' : 'down')

// ASSUMPTION: rekordbox's are uncaptured.
export const PITCH_COLOURS: Readonly<Record<PitchKind | 'asked', number>> = { zero: 21, up: 9, down: 53, asked: 127 }

export const pitchColour = (pitch: number, asked: number): number => PITCH_COLOURS[pitch === asked ? 'asked' : pitchKind(pitch)]

export const signed = (n: number): string => (n > 0 ? `+${n}` : String(n))

export function pitchPlan(views: ModeViews, asked: number, page: number | null): Plan {
  const steady: Steady[] = views.pages.flatMap(({ pads, shifted }, p) => [...pads.entries(), ...shifted.entries()].map(([i, out]): Steady => ({ kind: 'pad', out, value: pitchColour(pitchOf(p, i), asked) })))
  if (page !== null) steady.push({ kind: 'led', out: views.left, value: page === 0 }, { kind: 'led', out: views.right, value: page === 1 })
  return { steady, blinks: [] }
}

export const keyboardPlan = (views: ModeViews, deck: Pick<DeckState, 'loop' | 'hotCues'>, asked: number, choosing: boolean, page: number | null): Plan =>
  choosing ? hotCuePlan(views, padLightsOf(deck), page) : pitchPlan(views, asked, page)

// MAN p.33 items 3-4. ASSUMPTION: past ±12 the change shows its end.
export function jogScreenKey(deck: Pick<DeckState, 'loaded' | 'locked' | 'tempo' | 'tempoRange'>, original: Key): { readonly key: string; readonly change: string } {
  const offset = deck.loaded ? keyOffset(deck) : null
  if (offset === null) return { key: '---', change: '0' }
  return { key: keyName(movedBy(original, offset)), change: signed(Math.max(-MAX_SEMITONES, Math.min(MAX_SEMITONES, offset))) }
}
