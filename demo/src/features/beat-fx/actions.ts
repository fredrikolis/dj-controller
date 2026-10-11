// Concern: the Beat FX unit from page or controller: its state, routed to its target, told the FX BPM and beat; a change it cannot play refused | Non-concern: the rules, the audio | IO: (press) -> unit
import type { DeckIndex } from '../../shared/decks.ts'
import type { Desk } from '../../shared/engine/engine.ts'
import { logger } from '../../shared/logger.ts'
import { createStore, derived, type Watched } from '../../shared/store.ts'
import { playingBpm } from '../../shared/transport/bpm.ts'
import { gridOf } from '../../shared/transport/grid.ts'
import type { BeatFx, ReleaseFx, Target } from './effects.ts'
import { createRouter } from './route.ts'
import { createBeatFxUnit } from './unit.ts'
import { beatPressed, depthSet, fxBpm, phaseOf, refusal, releaseBeats, releaseHeld, releaseTyped, selected, targeted, toggled, type BeatFxState, type BpmSources } from './unit-state.ts'

export type BeatFxControls = {
  readonly state: Watched<BeatFxState>
  /** The FX BPM. */
  readonly bpm: Watched<number>
  select(effect: BeatFx): void
  target(target: Target): void
  toggle(): void
  /** BEAT ◀ (-1) or ▶ (1) at `time`, with SHIFT or not, `padsHeld` PAD FX pads held. */
  beat(direction: -1 | 1, shift: boolean, time: number, padsHeld: number): void
  depth(depth: number): void
  /** Held from now until the returned call. */
  release(): () => void
  releaseType(type: ReleaseFx): void
  releaseBeats(beats: number): void
  tick(): void
}

/** A change the unit cannot play, refused with the state unchanged. */
export class BeatFxRefused extends Error {
  override name = 'BeatFxRefused'
}

/** `act`, or null where it was refused, the refusal logged; any other failure thrown. */
export function unlessRefused<T>(act: () => T): T | null {
  try {
    return act()
  } catch (err) {
    if (!(err instanceof BeatFxRefused)) throw err
    logger.error('the Beat FX change was refused', err)
    return null
  }
}

export function startBeatFx(desk: Desk, initial: BeatFxState, signal: AbortSignal): BeatFxControls {
  const unit = createBeatFxUnit(desk.context, signal)
  const route = createRouter(desk.context, desk.mixer.points, unit, signal)
  const state = createStore(initial)
  const grids = desk.decks.map(gridOf)
  const beatOf = (i: DeckIndex, now: number): number | null => {
    const deck = desk.decks[i]
    const s = deck.state.state
    return s.loaded && s.playing ? (deck.positionAt(now) - grids[i].first) / grids[i].beat : null
  }
  const sources = (now: number): BpmSources => {
    const bpms = desk.decks.map((deck) => playingBpm(deck.state.state, deck.song.bpm))
    const loaded = (i: DeckIndex) => (desk.decks[i].state.state.loaded ? bpms[i] : null)
    return { decks: [loaded(0), loaded(1)], sampler: desk.sampler.bpm.state, master: desk.syncMaster.state }
  }
  const bpm = derived(() => fxBpm(state.state, sources(performance.now())), [state, desk.syncMaster, ...desk.decks.map((d) => d.state), desk.sampler.bpm])
  let target: Target | null = null
  state.watch((s) => {
    if (s.target !== target) route(s.target)
    target = s.target
    unit.apply(s, bpm.state)
  }, signal)
  const change = (next: (s: BeatFxState) => BeatFxState) => {
    const s = next(state.state)
    const refused = refusal(s, fxBpm(s, sources(performance.now())))
    if (refused !== null) throw new BeatFxRefused(refused)
    state.update(() => s)
  }
  return {
    state,
    bpm,
    select: (effect) => change((s) => selected(s, effect)),
    target: (t) => change((s) => targeted(s, t)),
    toggle: () => change(toggled),
    beat: (direction, shift, time, padsHeld) => change((s) => beatPressed(s, direction, shift, time, bpm.state, padsHeld)),
    depth: (d) => change((s) => depthSet(s, d)),
    release() {
      change((s) => releaseHeld(s, true))
      return () => state.update((s) => releaseHeld(s, false))
    },
    releaseType: (type) => change((s) => releaseTyped(s, type)),
    releaseBeats: (beats) => change((s) => releaseBeats(s, beats)),
    tick() {
      const now = performance.now()
      const s = state.state
      const from = sources(now)
      const phase = phaseOf(s, from.master)
      const lastTap = s.taps.at(-1)
      const beat = phase === 'tap' ? (lastTap === undefined ? null : ((now - lastTap) / 60000) * s.tapBpm) : phase === null ? null : beatOf(phase, now)
      unit.tick(beat, fxBpm(s, from))
    },
  }
}
