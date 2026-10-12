// Concern: one channel's Sound Color FX in Web Audio: processor, filters, noise, dub echo, reverb on the mixer's two colour points | Non-concern: which effect, how far | IO: (settings, BPM) -> audio
import { beatSeconds } from '../../shared/fx/dsp.ts'
import { echoOf, impulseOf, set } from '../../shared/fx/nodes.ts'
import { createProcessor } from '../../shared/fx/processor.ts'
import type { ColourPoints } from '../../shared/mixer/mixer.ts'
import type { Settings } from './rules.ts'

export type ColorFxUnit = { apply(settings: Settings, bpm: number): void }

// ASSUMPTION, all by ear: the filter's resonance, noise and reverb levels, the echo's 3/4 beat, the bands' corners, the room.
const RESONANCE_DB = 8
const FLAT_DB = -3
const NOISE_LEVEL = 0.3
const SPACE_LEVEL = 0.9
const ECHO_BEATS = 0.75
const ECHO = { feedback: 0.65, wet: 1, filters: [{ type: 'highpass', frequency: 150 }] } as const
const BANDS = {
  mid: { type: 'bandpass', frequency: 1000, Q: 0.8 },
  high: { type: 'highpass', frequency: 2000 },
  low: { type: 'lowpass', frequency: 2500 },
  spaceHigh: { type: 'highpass', frequency: 500 },
} as const satisfies Record<string, BiquadFilterOptions>
const ROOM_PERCENT = 40

function noiseOf(ctx: AudioContext): AudioBufferSourceNode {
  const buffer = ctx.createBuffer(1, 2 * ctx.sampleRate, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  return new AudioBufferSourceNode(ctx, { buffer, loop: true })
}

/** A send through whichever of two bands is asked, the other shut. */
function banded(ctx: AudioContext, from: AudioNode, a: BiquadFilterOptions, b: BiquadFilterOptions): { readonly out: GainNode; send(level: number, second: boolean): void; end(): void } {
  const out = new GainNode(ctx)
  const sends = [a, b].map((options) => {
    const send = new GainNode(ctx, { gain: 0 })
    from.connect(send).connect(new BiquadFilterNode(ctx, options)).connect(out)
    return send
  })
  return {
    out,
    send(level, second) {
      sends.forEach((send, i) => set(send.gain, (i === 1) === second ? level : 0, ctx))
    },
    end: () => sends.forEach((send) => from.disconnect(send)),
  }
}

/** Joined to `points` until `signal` aborts; the effect processor registered on `ctx` first. */
export function createColorFxUnit(ctx: AudioContext, points: ColourPoints, signal: AbortSignal): ColorFxUnit {
  const { node: processor, tell } = createProcessor(ctx, 1)
  const lowpass = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 20000, Q: FLAT_DB })
  const highpass = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 10, Q: FLAT_DB })
  points.pre.input.connect(processor).connect(lowpass).connect(highpass).connect(points.pre.output)
  points.pre.through.value = 0
  const noise = noiseOf(ctx)
  const noiseLow = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 20000, Q: FLAT_DB })
  const noiseHigh = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 10, Q: FLAT_DB })
  const noiseLevel = new GainNode(ctx, { gain: 0 })
  noise.connect(noiseLow).connect(noiseHigh).connect(noiseLevel).connect(points.pre.output)
  noise.start()
  // The post point keeps its own sound: the echo and the room are added to it.
  const echoIn = banded(ctx, points.post.input, BANDS.mid, BANDS.high)
  const echo = echoOf(ctx, echoIn.out, points.post.output, ECHO, true, signal)
  echo.wet.gain.value = ECHO.wet
  const spaceIn = banded(ctx, points.post.input, BANDS.low, BANDS.spaceHigh)
  const room = new ConvolverNode(ctx, { disableNormalization: true, buffer: impulseOf(ctx, ROOM_PERCENT) })
  const back = new GainNode(ctx, { gain: SPACE_LEVEL })
  spaceIn.out.connect(room).connect(back).connect(points.post.output)
  let told = { crush: 0, pitch: 1 }
  // ASSUMPTION: at 0 BPM the echo keeps its last time.
  let bpm = 120
  signal.addEventListener(
    'abort',
    () => {
      noise.stop()
      processor.port.close()
      points.pre.input.disconnect(processor)
      echoIn.end()
      spaceIn.end()
      highpass.disconnect()
      noiseLevel.disconnect()
      back.disconnect()
      points.pre.through.value = 1
    },
    { once: true },
  )
  return {
    apply(s, atBpm) {
      if (atBpm > 0) bpm = atBpm
      set(lowpass.frequency, s.lowpass, ctx, 0.02)
      set(highpass.frequency, s.highpass, ctx, 0.02)
      for (const filter of [lowpass, highpass]) set(filter.Q, s.resonant ? RESONANCE_DB : FLAT_DB, ctx, 0.02)
      if (s.crush !== told.crush) tell({ kind: 'crush', mix: s.crush })
      if (s.pitch !== told.pitch) tell({ kind: 'pitch', ratio: s.pitch })
      told = { crush: s.crush, pitch: s.pitch }
      set(noiseLow.frequency, s.noise.lowpass, ctx, 0.02)
      set(noiseHigh.frequency, s.noise.highpass, ctx, 0.02)
      set(noiseLevel.gain, NOISE_LEVEL * s.noise.level, ctx, 0.02)
      echoIn.send(s.echo.send, s.echo.band === 'high')
      echo.time(ECHO_BEATS * beatSeconds(bpm), 0.05)
      spaceIn.send(s.space.send, s.space.band === 'high')
    },
  }
}
