// Concern: the page's two decks by index, the other of one, and one deck's item replaced in a pair | Non-concern: what a deck is (transport/deck.ts) | IO: none
export type DeckIndex = 0 | 1

export const DECKS: readonly DeckIndex[] = [0, 1]

export type Pair<T> = readonly [T, T]

export const replaced = <T>(items: Pair<T>, deck: DeckIndex, item: T): Pair<T> => (deck === 0 ? [item, items[1]] : [items[0], item])

export const other = (deck: DeckIndex): DeckIndex => (deck === 0 ? 1 : 0)
