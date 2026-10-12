// Concern: the two-channel mixer: positions as state, TRIM, EQ, fader and crossfader gains, levels, headroom, limiter, FX points | Non-concern: the curves, the effects | IO: (positions) -> audio
import { DECKS, replaced, type DeckIndex, type Pair } from '../decks.ts'
import { createStore, type Watched } from '../store.ts'
import { crossfaderGain, eqDb, faderGain, trimGain, type Assign } from './curves.ts'
import { LIMITER, LIMITER_CHANNELS } from './limiter.ts'
import limiterUrl from './limiter.worklet.ts?worker&url'

export type Band = 'hi' | 'mid' | 'low'

export const BANDS: readonly Band[] = ['hi', 'mid', 'low']

/** Positions from 0 to 1. */
export type Channel = { readonly trim: number; readonly fader: number; readonly eq: Readonly<Record<Band, number>>; readonly assign: Assign }

export type Mix = { readonly channels: Pair<Channel>; readonly crossfader: number }

/** Where an effect unit may sit, its sound passed straight on at `through`. */
export type FxPoint = { readonly input: AudioNode; readonly output: AudioNode; readonly through: AudioParam }

/** A point on each channel after its fader, the sampler's before the master sum, the master's before the limiter. */
export type FxPoints = { readonly channels: Pair<FxPoint>; readonly sampler: FxPoint; readonly master: FxPoint }

/** A channel's Sound Color FX points: after its EQ, and after the crossfader, where an echo or reverb rings on (MAN p.174). */
export type ColourPoints = { readonly pre: FxPoint; readonly post: FxPoint }

export type Mixer = {
  readonly mix: Watched<Mix>
  /** Where deck `deck`'s player connects. */
  input(deck: DeckIndex): AudioNode
  /** Where the sampler deck joins the master: at the decks' output level, through its FX point. */
  readonly master: AudioNode
  readonly points: FxPoints
  readonly colour: Pair<ColourPoints>
  trim(deck: DeckIndex, position: number): void
  fader(deck: DeckIndex, position: number): void
  eq(deck: DeckIndex, band: Band, position: number): void
  assign(deck: DeckIndex, assign: Assign): void
  crossfader(position: number): void
  /** Channel `deck`'s peak over its last 2048 frames, after TRIM and EQ, before its fader (MAN p.51), from 0 to 1. */
  level(deck: DeckIndex): number
}

// ASSUMPTION: a DJ mixer's EQ corners: shelves at 70 Hz and 13 kHz, a peak at 1 kHz.
const FILTERS: Readonly<Record<Band, BiquadFilterOptions>> = {
  low: { type: 'lowshelf', frequency: 70 },
  mid: { type: 'peaking', frequency: 1000, Q: 0.7 },
  hi: { type: 'highshelf', frequency: 13000 },
}
const SMOOTH_SECS = 0.01
// rekordbox's [Output Level] before the mix (RB p.242): songs peak at 1.0, so one deck stays off the limiter.
const OUTPUT_LEVEL = 10 ** (-6 / 20)

type Strip = { level: GainNode; trim: GainNode; eq: Record<Band, BiquadFilterNode>; fader: GainNode; point: FxPoint; colour: ColourPoints; crossfader: GainNode; meter: AnalyserNode; samples: Float32Array<ArrayBuffer> }

function pointOf(ctx: AudioContext): FxPoint {
  const input = new GainNode(ctx)
  const output = new GainNode(ctx)
  const through = new GainNode(ctx)
  input.connect(through).connect(output)
  return { input, output, through: through.gain }
}

function strip(ctx: AudioContext, master: AudioNode): Strip {
  const eq = { low: new BiquadFilterNode(ctx, FILTERS.low), mid: new BiquadFilterNode(ctx, FILTERS.mid), hi: new BiquadFilterNode(ctx, FILTERS.hi) }
  const fader = new GainNode(ctx)
  const point = pointOf(ctx)
  const crossfader = new GainNode(ctx)
  const meter = new AnalyserNode(ctx, { fftSize: 2048 })
  const level = new GainNode(ctx, { gain: OUTPUT_LEVEL })
  const trim = new GainNode(ctx)
  level.connect(trim).connect(eq.low)
  const colour = { pre: pointOf(ctx), post: pointOf(ctx) }
  eq.low.connect(eq.mid).connect(eq.hi).connect(colour.pre.input)
  colour.pre.output.connect(fader).connect(point.input)
  point.output.connect(crossfader).connect(colour.post.input)
  colour.post.output.connect(master)
  eq.hi.connect(meter)
  return { level, trim, eq, fader, point, colour, crossfader, meter, samples: new Float32Array(meter.fftSize) }
}

const channel = (assign: Assign): Channel => ({ trim: 0.5, fader: 1, eq: { hi: 0.5, mid: 0.5, low: 0.5 }, assign })

export const registerMixer = (ctx: AudioContext): Promise<void> => ctx.audioWorklet.addModule(limiterUrl)

/** The mixer through the master limiter, registered on `ctx` first, following its state until `signal` aborts. */
export function createMixer(ctx: AudioContext, signal: AbortSignal): Mixer {
  const bus = new GainNode(ctx)
  const limiter = new AudioWorkletNode(ctx, LIMITER, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [LIMITER_CHANNELS], channelCount: LIMITER_CHANNELS, channelCountMode: 'explicit' })
  const masterPoint = pointOf(ctx)
  bus.connect(masterPoint.input)
  masterPoint.output.connect(limiter).connect(ctx.destination)
  const master = new GainNode(ctx, { gain: OUTPUT_LEVEL })
  const samplerPoint = pointOf(ctx)
  master.connect(samplerPoint.input)
  samplerPoint.output.connect(bus)
  const strips = [strip(ctx, bus), strip(ctx, bus)] as const
  const mix = createStore<Mix>({ channels: [channel('a'), channel('b')], crossfader: 0.5 })
  const set = (param: AudioParam, value: number) => param.setTargetAtTime(value, ctx.currentTime, SMOOTH_SECS)
  mix.watch(({ channels, crossfader }) => {
    for (const deck of DECKS) {
      const s = strips[deck]
      const c = channels[deck]
      for (const band of BANDS) set(s.eq[band].gain, eqDb(c.eq[band]))
      set(s.trim.gain, trimGain(c.trim))
      set(s.fader.gain, faderGain(c.fader))
      set(s.crossfader.gain, crossfaderGain(crossfader, c.assign))
    }
  }, signal)
  signal.addEventListener('abort', () => limiter.disconnect(), { once: true })
  const patch = (deck: DeckIndex, change: (c: Channel) => Channel) => mix.update((m) => ({ ...m, channels: replaced(m.channels, deck, change(m.channels[deck])) }))
  return {
    mix,
    input: (deck) => strips[deck].level,
    master,
    points: { channels: [strips[0].point, strips[1].point], sampler: samplerPoint, master: masterPoint },
    colour: [strips[0].colour, strips[1].colour],
    trim: (deck, trim) => patch(deck, (c) => ({ ...c, trim })),
    fader: (deck, fader) => patch(deck, (c) => ({ ...c, fader })),
    eq: (deck, band, position) => patch(deck, (c) => ({ ...c, eq: { ...c.eq, [band]: position } })),
    assign: (deck, assign) => patch(deck, (c) => (c.assign === assign ? c : { ...c, assign })),
    crossfader: (crossfader) => mix.update((m) => ({ ...m, crossfader })),
    level(deck) {
      const s = strips[deck]
      s.meter.getFloatTimeDomainData(s.samples)
      return Math.min(1, s.samples.reduce((peak, x) => Math.max(peak, Math.abs(x)), 0))
    },
  }
}
