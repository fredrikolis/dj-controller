// Concern: the DDJ-FLX10 as the demo plays it, connected or virtual: its model name, controller type, the page's decks on its decks 1 and 2 | Non-concern: what any control does | IO: none
import type { Controllers } from 'dj-controller'
import type { DeckIndex } from './decks.ts'

export const MODEL = 'DDJ-FLX10'

export type Flx10 = Controllers[typeof MODEL]

export type Flx10Deck = Flx10['decks'][DeckIndex]

// Unread, SHIFT layers too: browse (no track browser, MAN pp.11-12), DECK SELECT (no decks 3 and 4, p.20), ACTIVE PART (no parts, pp.22-23), MIX POINT (no Mix Point Link, p.15).
