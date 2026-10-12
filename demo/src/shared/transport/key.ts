// Concern: musical keys: moved, named as rekordbox does, a deck's current key, the shift syncing two | Non-concern: rendering, the jog screen | IO: (key, semitones) -> key
import type { DeckState } from './deck-state.ts'
import { rateOf } from './tempo.ts'

export type Key = { readonly tonic: number; readonly minor: boolean }

// Classic, as MML p.7 *3 spells them.
const MAJORS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const
const MINORS = ['Cm', 'Dbm', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'Abm', 'Am', 'Bbm', 'Bm'] as const

const pitchClass = (n: number): number => ((n % 12) + 12) % 12

export const keyName = (key: Key): string => (key.minor ? MINORS : MAJORS)[pitchClass(key.tonic)]

export const movedBy = (key: Key, semitones: number): Key => ({ ...key, tonic: pitchClass(key.tonic + semitones) })

type Pitched = Pick<DeckState, 'locked' | 'tempo' | 'tempoRange'>

// Unlocked, the TEMPO's pitch, rounded (RB p.130 item 11).
export function keyOffset(deck: Pitched): number | null {
  if (deck.locked) return deck.locked.semitones
  const rate = rateOf(deck.tempo, deck.tempoRange)
  return rate > 0 ? Math.round(12 * Math.log2(rate)) : null
}

export function currentKey(deck: Pitched, original: Key): Key | null {
  const offset = keyOffset(deck)
  return offset === null ? null : movedBy(original, offset)
}

// ASSUMPTION (RB p.170 states none): a minor key syncs to its relative major.
const harmonic = (key: Key): number => pitchClass(key.minor ? key.tonic + 3 : key.tonic)

export function syncShift(from: Key, to: Key): number {
  const up = pitchClass(harmonic(to) - harmonic(from))
  return up > 5 ? up - 12 : up
}

export type KeyedDeck = { readonly index: number; readonly state: Pick<DeckState, 'loaded' | 'locked' | 'tempo' | 'tempoRange' | 'keyShift' | 'keySync'>; readonly key: Key }

// RB p.170; with no key to follow, the one it synced to.
export function askedShift(deck: KeyedDeck, other: KeyedDeck): number {
  const target = deck.state.keySync && other.state.loaded ? currentKey(other.state, other.key) : null
  return target === null ? deck.state.keyShift : syncShift(deck.key, target)
}
