// Concern: renders targets of one composition with sva-wasm off the main thread, one at a time, each at its tempo | Non-concern: which composition, looping | IO: (RenderMessage) -> Rendered
//! One thread: sva-wasm's `startThreads` needs cross-origin isolation, which GitHub Pages cannot serve.
import init, { Composition } from '@scalable-vector-audio/sva-wasm'
import type { RenderMessage, Rendered } from './render-messages.ts'

// New tempi rendered as fast with 48 MB of cache as with 256 MB (Node 22): the budget keeps only tempi made.
const CACHE_BYTES = 64 * 1024 * 1024

const ready = init()
let composition: Promise<Composition> | null = null
// One render at a time, as each sets the composition's bpm.
let queue: Promise<void> = Promise.resolve()
const aborts = new Map<number, AbortController>()

async function open(nodes: readonly (readonly [string, string])[]): Promise<Composition> {
  await ready
  const comp = new Composition('dj-controller-demo')
  comp.cache_max_bytes = CACHE_BYTES
  for (const [path, text] of nodes) comp.insert(path, text)
  return comp
}

async function render(target: string, bpm: number, rate: number, signal: AbortSignal): Promise<Float32Array<ArrayBuffer>[]> {
  if (!composition) throw new Error(`no composition to render ${target} from: the worker was sent no nodes`)
  const comp = await composition
  signal.throwIfAborted()
  comp.insert('variables/bpm', String(bpm))
  const rendering = await comp.render(target, null, { rate, signal })
  try {
    return Array.from({ length: rendering.channels }, (_, c) => new Float32Array(rendering.samples(c)))
  } finally {
    rendering.free()
  }
}

async function reply(previous: Promise<void>, job: Extract<RenderMessage, { kind: 'render' }>, signal: AbortSignal): Promise<void> {
  const { id, target, bpm, rate } = job
  await previous
  try {
    const channels = await render(target, bpm, rate, signal)
    self.postMessage({ id, channels } satisfies Rendered, { transfer: channels.map((c) => c.buffer) })
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err : new Error(String(err)) } satisfies Rendered)
  } finally {
    aborts.delete(id)
  }
}

self.onmessage = (e: MessageEvent<RenderMessage>) => {
  const message = e.data
  if (message.kind === 'nodes') composition = open(message.nodes)
  else if (message.kind === 'abort') aborts.get(message.id)?.abort()
  else {
    const abort = new AbortController()
    aborts.set(message.id, abort)
    queue = reply(queue, message, abort.signal)
  }
}
