// Concern: a composition's renders in its own worker, each of a target at a tempo; a song's at a key shift, folded into a loop | Non-concern: the render itself | IO: (target, bpm, semitones) -> channels
import { loopFrames } from '../beat-grid/beat-grid.ts'
import type { RenderMessage, Rendered } from './render-messages.ts'
import { shiftedRender } from './shift.ts'
import { nodes, ROOT, type Song } from './songs.ts'

export type Channels = Float32Array<ArrayBuffer>[]

export type RenderWorker = {
  render(target: string, bpm: number, rate: number, signal: AbortSignal): Promise<Channels>
}

export type Renderer = {
  /** The song at `bpm`, `semitones` up or down, in frames of `rate`. */
  render(bpm: number, semitones: number, rate: number, signal: AbortSignal): Promise<Channels>
}

type Job = Extract<RenderMessage, { kind: 'render' }>

/** What rings past the loop's end is added onto its start. */
export function fold(samples: Float32Array, period: number): Float32Array<ArrayBuffer> {
  const loop = new Float32Array(period)
  samples.forEach((s, i) => (loop[i % period] = (loop[i % period] ?? 0) + s))
  return loop
}

function ask(worker: Worker, job: Job, signal: AbortSignal): Promise<Channels> {
  return new Promise((resolve, reject) => {
    const done = new AbortController()
    const settle = (settled: () => void) => {
      done.abort()
      settled()
    }
    if (signal.aborted) return reject(signal.reason)
    worker.addEventListener(
      'message',
      (e: MessageEvent<Rendered>) => {
        const reply = e.data
        if (reply.id === job.id) settle(() => ('error' in reply ? reject(reply.error) : resolve(reply.channels)))
      },
      { signal: done.signal },
    )
    worker.addEventListener('error', (e) => settle(() => reject(new Error('the render worker failed', { cause: e.error }))), { signal: done.signal })
    const abort = () => {
      worker.postMessage({ kind: 'abort', id: job.id } satisfies RenderMessage)
      settle(() => reject(signal.reason))
    }
    signal.addEventListener('abort', abort, { signal: done.signal })
    worker.postMessage(job)
  })
}

/** A worker holding `nodes`, rendering one target at a time until `signal` aborts. */
export function openWorker(nodes: readonly (readonly [string, string])[], signal: AbortSignal): RenderWorker {
  const worker = new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' })
  signal.addEventListener('abort', () => worker.terminate(), { once: true })
  worker.postMessage({ kind: 'nodes', nodes } satisfies RenderMessage)
  let id = 0
  return { render: (target, bpm, rate, jobSignal) => ask(worker, { kind: 'render', id: id++, target, bpm, rate }, jobSignal) }
}

/** Each render's time is a performance measure. */
export function openRenderer(song: Song, signal: AbortSignal): Renderer {
  const worker = openWorker(nodes(song), signal)
  return {
    async render(bpm, semitones, rate, jobSignal) {
      const start = performance.now()
      const asked = semitones === 0 ? `${bpm} BPM` : `${bpm} BPM, ${semitones > 0 ? '+' : ''}${semitones} semitones`
      try {
        const shifted = shiftedRender(bpm, semitones, rate)
        const channels = await worker.render(`@${ROOT}`, shifted.bpm, shifted.rate, jobSignal)
        performance.measure(`${song.title} rendered at ${asked}`, { start })
        return channels.map((c) => fold(c, loopFrames(song.bars, bpm, rate)))
      } catch (err) {
        throw new Error(`${song.title} did not render at ${asked}`, { cause: err })
      }
    },
  }
}
