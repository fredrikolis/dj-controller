// Concern: keeps a deck at the tempo and key its lock asks: rendered by SVA, swapped in once made, or unlocked | Non-concern: the arithmetic | IO: (deck state) -> renders, lock
import type { DeckIndex, Pair } from '../../shared/decks.ts'
import { changes, createStore } from '../../shared/store.ts'
import type { Deck } from '../../shared/transport/deck.ts'
import { shiftAskedOf } from '../../shared/transport/decks-key.ts'
import { lockedAt, renderedAt, sameLock } from '../../shared/transport/lock.ts'

type Render = { readonly at: number; readonly semitones: number }

// A synced deck's key follows the other's, so both decks' states ask.
const askedLock = (decks: Pair<Deck>, index: DeckIndex) => lockedAt(decks[index].state.state, decks[index].song.bpm, shiftAskedOf(decks, index))

const renderFor = (decks: Pair<Deck>, index: DeckIndex): Render | null => {
  const locked = askedLock(decks, index)
  return locked === null ? null : { at: renderedAt(locked.bpm, decks[index].song.bpm), semitones: locked.semitones }
}

const same = (a: Render | null, b: Render | null): boolean => a?.at === b?.at && a?.semitones === b?.semitones

/** Null once the deck asks for another render first. */
async function renderWhileAsked(decks: Pair<Deck>, index: DeckIndex, asked: Render, signal: AbortSignal): Promise<Float32Array<ArrayBuffer>[] | null> {
  const stale = new AbortController()
  const done = new AbortController()
  const deck = decks[index]
  for (const d of decks) d.state.watch(() => !same(renderFor(decks, index), asked) && stale.abort(), AbortSignal.any([signal, done.signal]))
  try {
    return await deck.render(asked.at, asked.semitones, AbortSignal.any([signal, stale.signal]))
  } catch (err) {
    if (stale.signal.aborted && !signal.aborted) return null
    throw err
  } finally {
    done.abort()
  }
}

export async function keepKeyLock(decks: Pair<Deck>, index: DeckIndex, signal: AbortSignal): Promise<void> {
  const deck = decks[index]
  const seen = createStore(0)
  for (const d of decks) d.state.watch(() => seen.update((n) => n + 1), signal)
  // The render the player holds, once this has told it one.
  let held: Render | null = null
  try {
    for await (const _ of changes(seen, signal)) {
      const s = deck.state.state
      const locked = askedLock(decks, index)
      if (!s.loaded || sameLock(locked, s.locked)) continue
      const asked = renderFor(decks, index)
      if (locked === null || asked === null) {
        deck.unlock()
        held = null
        continue
      }
      if (same(asked, held)) deck.lock(locked, asked.at)
      else if (asked.at === deck.song.bpm && asked.semitones === 0) deck.lock(locked, asked.at, null)
      else {
        const render = await renderWhileAsked(decks, index, asked, signal)
        if (!render) continue
        deck.lock(locked, asked.at, render)
      }
      held = asked
    }
  } catch (err) {
    if (!signal.aborted) throw err
  }
}
