// Concern: what a deck's KEY SHIFT and KEYBOARD pads light, the pitch asked brightest, hot cues while choosing, PAGE LEDs; the jog screen's key | Non-concern: writing them | IO: (deck, page) -> plan
import { MAX_SEMITONES } from '../../shared/engine/shift.ts'
import { hotCueLight } from '../../shared/hot-cues/lights.ts'
import { padPlan, pageShowing } from '../../shared/lights/pad-lights.ts'
import type { ModeViews, Plan } from '../../shared/lights/show-lights.ts'
import type { DeckState } from '../../shared/transport/deck-state.ts'
import { keyName, keyOffset, movedBy, type Key } from '../../shared/transport/key.ts'
import { pitchOf } from './semitones.ts'

type PitchKind = 'zero' | 'up' | 'down'

const pitchKind = (pitch: number): PitchKind => (pitch === 0 ? 'zero' : pitch > 0 ? 'up' : 'down')

// ASSUMPTION: rekordbox's are uncaptured.
const PITCH_COLOURS: Readonly<Record<PitchKind | 'asked', number>> = { zero: 21, up: 9, down: 53, asked: 127 }

const pitchLight = (asked: number) => (page: number, pad: number): number => {
  const pitch = pitchOf(page, pad)
  return PITCH_COLOURS[pitch === asked ? 'asked' : pitchKind(pitch)]
}

const signed = (n: number): string => (n > 0 ? `+${n}` : String(n))

export const pitchPlan = (views: ModeViews, asked: number, page: number | null): Plan => padPlan([{ views, light: pitchLight(asked), leds: pageShowing(page) }])

// MAN p.84: Keyboard's pads show the hot cues until one is chosen, then their pitches.
export const keyboardPlan = (views: ModeViews, deck: Pick<DeckState, 'loop' | 'hotCues'>, asked: number, choosing: boolean, page: number | null): Plan =>
  padPlan([{ views, light: choosing ? hotCueLight(deck) : pitchLight(asked), leds: pageShowing(page) }])

// MAN p.33 items 3-4. ASSUMPTION: past ±12 the change shows its end.
export function jogScreenKey(deck: Pick<DeckState, 'loaded' | 'locked' | 'tempo' | 'tempoRange'>, original: Key): { readonly key: string; readonly change: string } {
  const offset = deck.loaded ? keyOffset(deck) : null
  if (offset === null) return { key: '---', change: '0' }
  return { key: keyName(movedBy(original, offset)), change: signed(Math.max(-MAX_SEMITONES, Math.min(MAX_SEMITONES, offset))) }
}
