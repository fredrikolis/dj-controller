// Concern: a desk deck's key shift asked, read from both decks: a synced deck's following the other's key | Non-concern: the key arithmetic (key.ts) | IO: (decks, index) -> semitones
import { other, type DeckIndex, type Pair } from '../decks.ts'
import type { Deck } from './deck.ts'
import { askedShift, type KeyedDeck } from './key.ts'

export const keyedOf = (decks: Pair<Deck>, index: DeckIndex): KeyedDeck => ({ index, state: decks[index].state.state, key: decks[index].song.key })

export const shiftAskedOf = (decks: Pair<Deck>, index: DeckIndex): number => askedShift(keyedOf(decks, index), keyedOf(decks, other(index)))
