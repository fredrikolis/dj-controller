// Concern: the frames a browser's delay cycle returns its feedback late by, measured once for a context | Non-concern: the delays that take it off (nodes.ts) | IO: (context) -> frames
const measured = new WeakMap<BaseAudioContext, number>()

const FIRST = 512
const SPAN = 4096

async function measure(sampleRate: number): Promise<number> {
  const ctx = new OfflineAudioContext(1, SPAN, sampleRate)
  const click = ctx.createBuffer(1, 1, sampleRate)
  click.getChannelData(0)[0] = 1
  const source = new AudioBufferSourceNode(ctx, { buffer: click })
  const delay = new DelayNode(ctx, { maxDelayTime: 1, delayTime: FIRST / sampleRate })
  source.connect(delay).connect(ctx.destination)
  delay.connect(new GainNode(ctx, { gain: 0.5 })).connect(delay)
  source.start()
  const heard = (await ctx.startRendering()).getChannelData(0)
  let second = FIRST + 1
  for (let i = second; i < SPAN; i++) if (Math.abs(heard[i] ?? 0) > Math.abs(heard[second] ?? 0)) second = i
  const lag = second - 2 * FIRST
  if (!((heard[second] ?? 0) > 0.25) || lag < 0 || lag >= FIRST) throw new RangeError(`a delay of ${FIRST} frames fed back repeated at frame ${second}, not from ${2 * FIRST} on: the cycle's lag cannot be told`)
  return lag
}

// Chrome 149 returns a cycle's feedback a render quantum late (observed 2026-10-11).
export async function measureCycleLag(ctx: BaseAudioContext): Promise<void> {
  if (!measured.has(ctx)) measured.set(ctx, await measure(ctx.sampleRate))
}

/** In seconds. */
export function cycleLag(ctx: BaseAudioContext): number {
  const frames = measured.get(ctx)
  if (frames === undefined) throw new Error('the delay cycle lag of this audio context is not measured; registerFx measures it')
  return frames / ctx.sampleRate
}
