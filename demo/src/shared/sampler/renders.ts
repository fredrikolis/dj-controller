// Concern: each slot's sound rendered by SVA in its own worker, loops folded to their bars and rendered again at each BPM asked | Non-concern: playing them | IO: (BPM asked) -> sounds
import { BEATS_PER_BAR, loopFrames } from '../beat-grid/beat-grid.ts'
import { fold, openWorker } from '../engine/render.ts'
import { changes, createStore, type Watched } from '../store.ts'
import { SLOTS, type Slot } from './banks.ts'
import { SAMPLE_NODES } from './samples.ts'

/** `bpm`: the BPM it was rendered at. */
export type Sound = { readonly buffer: AudioBuffer; readonly bpm: number }

export type Sounds = ReadonlyMap<string, Sound>

const NODES = [...SAMPLE_NODES, ['variables/meter', `${BEATS_PER_BAR}/4`] as const]

function checkNodes(): void {
  const known = new Set(SAMPLE_NODES.map(([path]) => path))
  const missing = SLOTS.filter((slot) => !known.has(slot.node)).map((slot) => `${slot.name} (${slot.node}.sva)`)
  if (missing.length > 0) throw new Error(`the sampler's banks name sounds demo/samples lacks: ${missing.join(', ')}`)
}

/** Renders each slot until `signal` aborts; rejects with a render that failed. */
export function keepSounds(ctx: BaseAudioContext, asked: Watched<number>, playing: () => ReadonlySet<string>, signal: AbortSignal): { readonly sounds: Watched<Sounds>; readonly done: Promise<void> } {
  checkNodes()
  const worker = openWorker(NODES, signal)
  const sounds = createStore<Sounds>(new Map())
  const render = async (slot: Slot, bpm: number, jobSignal: AbortSignal): Promise<void> => {
    const start = performance.now()
    const [samples] = await worker.render(`@${slot.node}`, bpm, ctx.sampleRate, jobSignal)
    if (!samples) throw new Error(`${slot.name} rendered no channel at ${bpm} BPM`)
    const mono = slot.bars === null ? samples : fold(samples, loopFrames(slot.bars, bpm, ctx.sampleRate))
    const buffer = new AudioBuffer({ length: mono.length, sampleRate: ctx.sampleRate, numberOfChannels: 1 })
    buffer.copyToChannel(mono, 0)
    performance.measure(`sampler ${slot.name} rendered at ${bpm} BPM`, { start })
    sounds.update((s) => new Map(s).set(slot.node, { buffer, bpm }))
  }
  const loops = SLOTS.filter((slot) => slot.mode === 'loop')
  const rerender = async (bpm: number): Promise<void> => {
    const stale = new AbortController()
    const done = new AbortController()
    asked.watch((now) => now !== bpm && stale.abort(), AbortSignal.any([signal, done.signal]))
    const first = playing()
    const order = [...loops.filter((l) => first.has(l.node)), ...loops.filter((l) => !first.has(l.node))]
    try {
      for (const slot of order) if (sounds.state.get(slot.node)?.bpm !== bpm) await render(slot, bpm, AbortSignal.any([signal, stale.signal]))
    } catch (err) {
      if (!stale.signal.aborted || signal.aborted) throw err
    } finally {
      done.abort()
    }
  }
  const run = async (): Promise<void> => {
    try {
      for (const slot of SLOTS) await render(slot, asked.state, signal)
      for await (const bpm of changes(asked, signal)) await rerender(bpm)
    } catch (err) {
      if (signal.aborted) return
      throw new Error('the sampler stopped rendering its sounds', { cause: err })
    }
  }
  return { sounds, done: run() }
}
