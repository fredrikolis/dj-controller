// Concern: vinyl mode as rekordbox plays it on a DDJ-FLX10: switched, letting go of a held platter, and whether a touch holds it | Non-concern: what a turn does | IO: (deck, touch) -> state, hold
import type { DeckState } from '../../shared/transport/deck-state.ts'

export const switched = (deck: Pick<DeckState, 'vinyl'>): Pick<DeckState, 'vinyl' | 'touched'> => ({ vinyl: !deck.vinyl, touched: false })

// MAN p.20: SHIFT + turn edits the beatgrid; the demo's is its song's own, with none stored to edit, so a touch with SHIFT does nothing.
export const holds = (shift: boolean, vinyl: boolean): boolean => vinyl && !shift
