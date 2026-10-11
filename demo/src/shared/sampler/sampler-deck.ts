// Concern: the sampler deck: its state, sounds rendered, voices played as the state says at the BPM it and the decks give | Non-concern: the press rules (features/sampler) | IO: (state, decks) -> audio
import type { DeckIndex, Pair } from '../decks.ts'
import { createStore, derived, type Watched } from '../store.ts'
import { playingBpm } from '../transport/bpm.ts'
import type { Deck } from '../transport/deck.ts'
import { gridOf } from '../transport/grid.ts'
import { slotAt } from './banks.ts'
import { bpmOf, gainOf, loopOffset, renderBpmOf, volumeOf, type DeckClock } from './clock.ts'
import { keepSounds, type Sounds } from './renders.ts'
import { SAMPLER_START, withoutVoice, type SamplerState, type Voice } from './sampler-state.ts'
import { createVoices, type Start } from './voices.ts'

export type SamplerDeck = {
  readonly state: Watched<SamplerState>
  readonly sounds: Watched<Sounds>
  /** Its own BPM, or the master deck's under BPM SYNC. */
  readonly bpm: Watched<number>
  update(change: (s: SamplerState) => SamplerState): void
  /** A voice id no voice has had. */
  newId(): number
  /** Rejects once its sounds stop rendering. */
  readonly done: Promise<void>
}

function clockOf(deck: Deck, time: number): DeckClock {
  const s = deck.state.state
  const grid = gridOf(deck)
  return { playing: s.loaded && s.playing, bpm: playingBpm(s, deck.song.bpm), beat: (deck.positionAt(time) - grid.first) / grid.beat }
}

/** `syncMaster`: the deck its BPM SYNC and Q follow. */
export function createSamplerDeck(ctx: AudioContext, master: AudioNode, decks: Pair<Deck>, syncMaster: Watched<DeckIndex>, signal: AbortSignal): SamplerDeck {
  const state = createStore<SamplerState>(SAMPLER_START)
  const voices = createVoices(ctx, master, (id) => state.update((s) => withoutVoice(s, id)), signal)
  const clock = () => clockOf(decks[syncMaster.state], performance.now())
  const bpm = derived(() => bpmOf(state.state, clock()), [state, syncMaster, ...decks.map((d) => d.state)])
  const asked = derived(() => renderBpmOf(bpm.state), [bpm])
  const { sounds, done } = keepSounds(ctx, asked, () => voices.loops(), signal)

  const startOf = (s: SamplerState) => (voice: Voice): Start => {
    const slot = slotAt(voice.bank, voice.position)
    const sound = slot && sounds.state.get(slot.node)
    if (!slot || !sound) throw new Error(`sampler voice ${voice.id} names bank ${voice.bank + 1} position ${voice.position + 1}, which has no rendered sound; a press is refused before then`)
    return { slot, sound, offset: slot.mode === 'loop' ? loopOffset(s, clock(), sound.bpm) : 0 }
  }
  state.watch((s) => {
    voices.apply(s.voices, bpm.state, startOf(s))
    voices.levels(gainOf(s.gain), volumeOf(s.volume))
  }, signal)
  bpm.watch((now) => voices.follow(now), signal)
  sounds.watch((now) => voices.swap(now, bpm.state), signal)
  let ids = 0
  return { state, sounds, bpm, update: state.update, newId: () => ++ids, done }
}
