// Concern: renders a deck's pad pitches ahead, one at a time, at the BPM a pad would lock to, so a pad plays its key at once | Non-concern: which pitches show | IO: (deck, pitches) -> renders kept
import { changes, createStore, type Watched } from '../../shared/store.ts'
import type { DeckState } from '../../shared/transport/deck-state.ts'
import { lockedBpm, renderedAt } from '../../shared/transport/lock.ts'

export type Ahead = { readonly at: number; readonly semitones: number }

export type Rendering = {
  readonly state: Watched<DeckState>
  readonly song: { readonly title: string; readonly bpm: number }
  render(bpm: number, semitones: number, signal: AbortSignal): Promise<unknown>
}

export function aheadOf(s: DeckState, bpm: number, pitches: readonly number[]): Ahead[] {
  if (!s.loaded) return []
  return pitches.flatMap((semitones) => {
    const at = renderedAt(lockedBpm(s, bpm), bpm)
    return semitones === 0 && at === bpm ? [] : [{ at, semitones }]
  })
}

const key = (asked: readonly Ahead[]): string => asked.map((a) => `${a.at}/${a.semitones}`).join(' ')

// ASSUMPTION: rekordbox shifts at once; renders made ahead keep SVA up with it.
export async function renderAhead(deck: Rendering, pitches: Watched<readonly number[]>, signal: AbortSignal): Promise<void> {
  const asked = createStore<readonly Ahead[]>([])
  const ask = () => asked.update((was) => {
    const now = aheadOf(deck.state.state, deck.song.bpm, pitches.state)
    return key(now) === key(was) ? was : now
  })
  deck.state.watch(ask, signal)
  pitches.watch(ask, signal)
  try {
    for await (const round of changes(asked, signal)) {
      const stale = new AbortController()
      const done = new AbortController()
      asked.watch((now) => now !== round && stale.abort(), AbortSignal.any([signal, done.signal]))
      try {
        for (const { at, semitones } of round) await deck.render(at, semitones, AbortSignal.any([signal, stale.signal]))
      } catch (err) {
        if (!stale.signal.aborted) throw new Error(`${deck.song.title} did not render ahead`, { cause: err })
      } finally {
        done.abort()
      }
    }
  } catch (err) {
    if (!signal.aborted) throw err
  }
}
