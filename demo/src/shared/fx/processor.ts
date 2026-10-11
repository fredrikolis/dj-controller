// Concern: the effect processor on a context: its module registered once, a node of it made | Non-concern: what it plays (fx.worklet.ts) | IO: (context) -> node
import { measureCycleLag } from './cycle.ts'
import fxUrl from './fx.worklet.ts?worker&url'
import { FX_PROCESSOR, type FxMessage } from './messages.ts'

const registered = new WeakMap<BaseAudioContext, Promise<void>>()

export function registerFx(ctx: BaseAudioContext): Promise<void> {
  const known = registered.get(ctx)
  if (known) return known
  const loading = Promise.all([ctx.audioWorklet.addModule(fxUrl), measureCycleLag(ctx)]).then(() => undefined, (err: unknown) => {
    registered.delete(ctx)
    throw new Error('the effect processor did not load', { cause: err })
  })
  registered.set(ctx, loading)
  return loading
}

export type FxProcessor = { readonly node: AudioWorkletNode; tell(message: FxMessage): void }

/** A processor of `channels` channels, its input mixed to them; registered on `ctx` first. */
export function createProcessor(ctx: BaseAudioContext, channels: number): FxProcessor {
  const node = new AudioWorkletNode(ctx, FX_PROCESSOR, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [channels], channelCount: channels, channelCountMode: 'explicit', processorOptions: { channels } })
  return { node, tell: (message) => node.port.postMessage(message) }
}
