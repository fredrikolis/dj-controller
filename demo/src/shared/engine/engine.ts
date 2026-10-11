// Concern: the page's audio: player, mixer, a deck per song with its renderer, each channel's insert, the sampler deck, the sync master | Non-concern: what plays when | IO: (AudioContext) -> Desk
import { registerPlayer, createDeck, type Deck } from '../transport/deck.ts'
import type { DeckIndex, Pair } from '../decks.ts'
import { createMixer, registerMixer, type Mixer } from '../mixer/mixer.ts'
import { createSamplerDeck, type SamplerDeck } from '../sampler/sampler-deck.ts'
import { createStore, derived, type Watched } from '../store.ts'
import { masterOf } from '../transport/sync-master.ts'
import { openRenderer } from './render.ts'
import { SONGS } from './songs.ts'

export type Insert = { readonly input: AudioNode; readonly output: AudioNode }

export type Desk = {
  readonly context: AudioContext
  readonly decks: Pair<Deck>
  readonly mixer: Mixer
  readonly sampler: SamplerDeck
  /** The deck the sampler's BPM SYNC and Beat FX's MST follow. */
  readonly syncMaster: Watched<DeckIndex>
  chooseMaster(deck: DeckIndex): void
  insert(deck: DeckIndex, chain: Insert, signal: AbortSignal): void
}

/** Two decks of the demo's songs into a mixer on `ctx`, until `signal` aborts; no song is loaded yet. */
export async function createDesk(ctx: AudioContext, signal: AbortSignal): Promise<Desk> {
  try {
    await registerPlayer(ctx)
  } catch (err) {
    throw new Error('the deck player did not load', { cause: err })
  }
  try {
    await registerMixer(ctx)
  } catch (err) {
    throw new Error('the master limiter did not load', { cause: err })
  }
  const mixer = createMixer(ctx, signal)
  const taps = [new GainNode(ctx), new GainNode(ctx)] as const
  const inserted: [boolean, boolean] = [false, false]
  taps.forEach((tap, i) => tap.connect(mixer.input(i as DeckIndex)))
  const deck = (i: DeckIndex) => createDeck(ctx, SONGS[i], openRenderer(SONGS[i], signal), taps[i], signal)
  const decks = [deck(0), deck(1)] as const
  const chosen = createStore<DeckIndex | null>(null)
  const playing = (d: Deck) => d.state.state.loaded && d.state.state.playing
  const syncMaster = derived(() => masterOf(chosen.state, [playing(decks[0]), playing(decks[1])]), [chosen, decks[0].state, decks[1].state])
  return {
    context: ctx,
    decks,
    mixer,
    sampler: createSamplerDeck(ctx, mixer.master, decks, syncMaster, signal),
    syncMaster,
    chooseMaster: (d) => chosen.update(() => d),
    insert(i, chain, insertSignal) {
      if (insertSignal.aborted) return
      if (inserted[i]) throw new Error(`deck ${i + 1} already has an insert between its player and mixer channel; end it first`)
      inserted[i] = true
      const tap = taps[i]
      tap.disconnect()
      tap.connect(chain.input)
      chain.output.connect(mixer.input(i))
      insertSignal.addEventListener(
        'abort',
        () => {
          tap.disconnect()
          chain.output.disconnect()
          tap.connect(mixer.input(i))
          inserted[i] = false
        },
        { once: true },
      )
    },
  }
}
