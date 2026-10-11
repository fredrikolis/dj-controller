// Concern: key shift and Keyboard as rekordbox plays them on a DDJ-FLX10: pads' pitches, KEY SYNC, KEY RESET, semitones, a hot cue chosen | Non-concern: the controls | IO: (deck, press) -> deck
import { MAX_SEMITONES } from '../../shared/engine/shift.ts'
import type { DeckState } from '../../shared/transport/deck-state.ts'
import { askedShift, currentKey, syncShift, type KeyedDeck } from '../../shared/transport/key.ts'
import type { HotCues } from '../../shared/transport/hot-cue-state.ts'
import { slotOf } from '../../shared/hot-cues/hot-cue.ts'

// MAN p.86, p.85; page 2 ASSUMPTION: Serato's Down range on this unit (MAN p.134).
export const PAD_PITCHES: readonly (readonly number[])[] = [
  [4, 5, 6, 7, 0, 1, 2, 3],
  [-3, -2, -1, 0, -7, -6, -5, -4],
]

export function pitchOf(page: number, pad: number): number {
  const pitch = PAD_PITCHES[page]?.[pad]
  if (pitch === undefined) throw new RangeError(`no key shift pitch for page ${page + 1} pad ${pad + 1}: the FLX10 has 2 pages of 8 pads (MML p.7 *1)`)
  return pitch
}

export type Keyed = Pick<DeckState, 'keyShift' | 'keySync'>

// ASSUMPTION: a key set by hand ends key sync.
export const shiftedTo = (semitones: number): Keyed => ({ keyShift: Math.max(-MAX_SEMITONES, Math.min(MAX_SEMITONES, semitones)), keySync: false })

// SHIFT+KEY SYNC (MAN p.17 item 11, p.87 step 4).
export const RESET: Keyed = { keyShift: 0, keySync: false }

export class KeySyncRefused extends Error {}

// MAN p.17.
export function syncedShift(deck: KeyedDeck, other: KeyedDeck): number {
  const unloaded = [deck, other].find((d) => !d.state.loaded)
  if (unloaded) throw new KeySyncRefused(`KEY SYNC on deck ${deck.index + 1} matches deck ${other.index + 1}'s key, and deck ${unloaded.index + 1} has no song loaded`)
  const target = currentKey(other.state, other.key)
  if (target === null) throw new KeySyncRefused(`KEY SYNC on deck ${deck.index + 1}: deck ${other.index + 1} stands still at TEMPO 0 and sounds in no key`)
  return syncShift(deck.key, target)
}

// RB p.170 step 2.
export const pressKeySync = (deck: KeyedDeck, other: KeyedDeck): Keyed => (deck.state.keySync ? { keyShift: askedShift(deck, other), keySync: false } : { keyShift: syncedShift(deck, other), keySync: true })

// MAN p.84 step 2: null while choosing.
export type Chosen = number | null

export type KeyboardStep = { readonly chosen: Chosen; readonly hotCue: number | null; readonly semitones: number | null }

// MAN p.84 step 2, p.85 step 4; ASSUMPTION: a choice since cleared chooses again.
export const chosenCue = (chosen: Chosen, hotCues: HotCues): Chosen => (chosen !== null && hotCues[chosen] != null ? chosen : null)

export function pressKeyboard(chosen: Chosen, hotCues: HotCues, page: number, pad: number): KeyboardStep {
  if (chosenCue(chosen, hotCues) === null) {
    const slot = slotOf(page, pad)
    return { chosen: slot, hotCue: hotCues[slot] == null ? slot : null, semitones: null }
  }
  return { chosen, hotCue: chosen, semitones: pitchOf(page, pad) }
}
