// Concern: one deck on the main thread: state told to its player, seeks, jogs or their taker, searches, its song loaded, renders swapped in, its position | Non-concern: the rules | IO: state -> player
import type { Renderer } from '../engine/render.ts'
import type { Song } from '../engine/songs.ts'
import { createStore, type Watched } from '../store.ts'
import { loadedState, type DeckState, type Lock } from './deck-state.ts'
import { keptRenders } from './kept-renders.ts'
import { NO_HOT_CUES } from './hot-cue-state.ts'
import { activeLoop, NO_LOOP, sought, type LoopPoints } from './loop-state.ts'
import { NO_MEMORY_CUES } from './memory-cue-state.ts'
import { PLAYER, type PlayerMessage, type PlayerReport } from './player-messages.ts'
import { FIRST_RANGE, rateOf } from './tempo.ts'
import playerUrl from './player.worklet.ts?worker&url'

export type Deck = {
  readonly song: Song
  readonly sampleRate: number
  readonly state: Watched<DeckState>
  /** In frames of the loaded song, as last reported. */
  readonly position: number
  /** At `time`, an event's: the last report moved on at its speed. */
  positionAt(time: number): number
  update(patch: Partial<Omit<DeckState, 'loaded' | 'locked'>>): void
  seek(frame: number): void
  jog(frames: number): void
  /** Frames a frame on top of play, signed, until 0. */
  search(speed: number): void
  /** The newest taker has the jogs. */
  takeJogs(take: (frames: number) => void, signal: AbortSignal): void
  load(signal: AbortSignal): Promise<void>
  /** Renders made are kept for one `bpm`: one asked again resolves at once; asking another `bpm` drops them. */
  render(bpm: number, semitones: number, signal: AbortSignal): Promise<Float32Array<ArrayBuffer>[]>
  /** As `lock` from a render made at `at` BPM, read slower where its BPM is under it: `render` swapped in at the same point of the song, null the song as loaded, absent the render playing. */
  lock(lock: Lock, at: number, render?: Float32Array<ArrayBuffer>[] | null): void
  unlock(): void
}

export const registerPlayer = (ctx: AudioContext): Promise<void> => ctx.audioWorklet.addModule(playerUrl)

const transferred = (message: PlayerMessage): ArrayBuffer[] => {
  const song = message.kind === 'load' ? message.song : message.kind === 'lock' ? message.render : null
  return song ? song.map((c) => c.buffer) : []
}

const samePoints = (a: LoopPoints | null, b: LoopPoints | null): boolean => a === b || (a !== null && b !== null && a.in === b.in && a.out === b.out)

/** Its player registered on `ctx` first; it starts key-locked at the song's tempo. */
export function createDeck(ctx: AudioContext, song: Song, renderer: Renderer, output: AudioNode, signal: AbortSignal): Deck {
  const node = new AudioWorkletNode(ctx, PLAYER, { numberOfInputs: 0, outputChannelCount: [1] })
  const rate = node.parameters.get('rate')
  if (!rate) throw new TypeError(`${PLAYER} has no rate parameter`)
  node.connect(output)
  const state = createStore<DeckState>({
    loaded: false,
    playing: false,
    reverse: false,
    touched: false,
    // MAN p.88.
    vinyl: true,
    tempo: 0.5,
    tempoRange: FIRST_RANGE,
    cue: 0,
    previewing: false,
    masterTempo: true,
    keyShift: 0,
    keySync: false,
    locked: { bpm: song.bpm, semitones: 0 },
    // As rekordbox: flx10-connect.md frames 139-155, 197-287.
    quantize: true,
    loop: NO_LOOP,
    hotCues: NO_HOT_CUES,
    memoryCues: NO_MEMORY_CUES,
  })
  let report = { position: 0, speed: 0, at: performance.now() }
  node.port.onmessage = (e: MessageEvent<PlayerReport>) => {
    if (e.data.kind === 'ended') state.update((s) => (s.playing ? { ...s, playing: false, previewing: false } : s))
    else report = { position: e.data.position, speed: e.data.framesASecond, at: performance.now() }
  }
  signal.addEventListener(
    'abort',
    () => {
      node.port.close()
      node.disconnect()
    },
    { once: true },
  )
  const tell = (message: PlayerMessage) => node.port.postMessage(message, transferred(message))
  let told: DeckState | null = null
  state.watch((now) => {
    if (now.playing !== told?.playing) tell({ kind: 'play', on: now.playing })
    if (now.reverse !== told?.reverse) tell({ kind: 'reverse', on: now.reverse })
    if (now.touched !== told?.touched) tell({ kind: 'hold', on: now.touched })
    if (now.tempo !== told?.tempo || now.tempoRange !== told.tempoRange) rate.setTargetAtTime(rateOf(now.tempo, now.tempoRange), ctx.currentTime, 0.01)
    const loop = activeLoop(now.loop)
    if (!told || !samePoints(loop, activeLoop(told.loop))) tell({ kind: 'loop', loop })
    told = now
  }, signal)
  const takers: ((frames: number) => void)[] = []
  const kept = keptRenders((bpm, semitones, keptSignal) => renderer.render(bpm, semitones, ctx.sampleRate, AbortSignal.any([signal, keptSignal])))
  return {
    song,
    sampleRate: ctx.sampleRate,
    state,
    get position() {
      return report.position
    },
    positionAt: (time) => Math.max(0, report.position + ((time - report.at) / 1000) * report.speed),
    update: (patch) => state.update((s) => ({ ...s, ...patch })),
    seek(frame) {
      tell({ kind: 'seek', frame })
      state.update((s) => {
        const loop = sought(s.loop, frame)
        return loop === s.loop ? s : { ...s, loop }
      })
    },
    jog(frames) {
      const take = takers.at(-1)
      if (take) take(frames)
      else tell({ kind: 'jog', frames })
    },
    search: (speed) => tell({ kind: 'search', speed }),
    takeJogs(take, takeSignal) {
      if (takeSignal.aborted) return
      takers.push(take)
      takeSignal.addEventListener('abort', () => takers.splice(takers.indexOf(take), 1), { once: true })
    },
    async load(loadSignal) {
      tell({ kind: 'load', song: await renderer.render(song.bpm, 0, ctx.sampleRate, loadSignal) })
      state.update(loadedState)
    },
    render: kept,
    lock(locked, at, render) {
      tell({ kind: 'lock', render, rate: locked.bpm / at })
      state.update((s) => ({ ...s, locked }))
    },
    unlock() {
      tell({ kind: 'unlock' })
      state.update((s) => ({ ...s, locked: null }))
    },
  }
}
