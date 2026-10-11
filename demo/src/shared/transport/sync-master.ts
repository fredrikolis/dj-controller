// Concern: which deck is the sync master: the one chosen, else the one playing | Non-concern: what follows it (the sampler, Beat FX), choosing | IO: (choice, decks playing) -> deck
import type { DeckIndex, Pair } from '../decks.ts'

// MAN p.17, RB p.168. ASSUMPTION: none chosen, the deck playing, deck 1 when both or neither play.
export const masterOf = (chosen: DeckIndex | null, playing: Pair<boolean>): DeckIndex => chosen ?? (playing[1] && !playing[0] ? 1 : 0)
