// Concern: the Web Audio parts rekordbox's effects are built of: echoes, a reverb impulse, a flanger, a phaser, smoothed and gliding params | Non-concern: which effect is on | IO: (context) -> nodes
import { cycleLag } from './cycle.ts'
import { DELAY_SECONDS } from './messages.ts'

const SMOOTH = 0.01

export const set = (param: AudioParam, value: number, ctx: BaseAudioContext, smooth = SMOOTH): AudioParam => param.setTargetAtTime(value, ctx.currentTime, smooth)

type EchoVoice = { readonly feedback: number; readonly wet: number; readonly filters: readonly BiquadFilterOptions[] }

// ASSUMPTION: the voicing of each echo, tuned by ear: MAN p.94 (ECHO, LOW CUT ECHO), p.100 (DUB ECHO).
export const ECHOES = {
  echo: { feedback: 0.5, wet: 0.7, filters: [{ type: 'highpass', frequency: 120 }, { type: 'lowpass', frequency: 6000 }] },
  lowCutEcho: { feedback: 0.55, wet: 0.95, filters: [{ type: 'highpass', frequency: 600 }, { type: 'lowpass', frequency: 9000 }] },
  dubEcho: { feedback: 0.7, wet: 1, filters: [{ type: 'bandpass', frequency: 1000, Q: 0.7 }] },
  releaseEcho: { feedback: 0.6, wet: 1, filters: [{ type: 'highpass', frequency: 150 }, { type: 'lowpass', frequency: 5000 }] },
} as const satisfies Record<string, EchoVoice>

export type EchoEffect = keyof typeof ECHOES

const QUANTUM = 128

export type Repeats = {
  readonly input: GainNode
  readonly output: GainNode
  readonly feedback: GainNode
  time(seconds: number, smooth: number): void
  /** At `rate` seconds a second: the sound in the delay plays that much faster or slower meanwhile. */
  slide(seconds: number, rate: number): void
}

/** Repeats a whole delay time apart, each through `colour` once more; the cycle's pass is shortened by the browser's lag. */
export function repeatsOf(ctx: BaseAudioContext, feedback: number, colour: () => readonly AudioNode[]): Repeats {
  const lag = cycleLag(ctx)
  const input = new GainNode(ctx)
  const output = new GainNode(ctx)
  const first = new DelayNode(ctx, { maxDelayTime: DELAY_SECONDS, delayTime: 0.25 })
  const again = new DelayNode(ctx, { maxDelayTime: DELAY_SECONDS, delayTime: 0.25 - lag })
  const back = new GainNode(ctx, { gain: feedback })
  const through = (from: AudioNode) => colour().reduce<AudioNode>((node, next) => node.connect(next), from)
  through(input.connect(first)).connect(output)
  through(output.connect(back).connect(again)).connect(output)
  const checked = (seconds: number) => {
    if (!(seconds - lag >= QUANTUM / ctx.sampleRate)) throw new RangeError(`repeats ${seconds} s apart are closer than a delay cycle passes on this browser: ${lag + QUANTUM / ctx.sampleRate} s`)
  }
  let aimed = 0.25
  return {
    input,
    output,
    feedback: back,
    time(seconds, smooth) {
      checked(seconds)
      aimed = seconds
      set(first.delayTime, seconds, ctx, smooth)
      set(again.delayTime, seconds - lag, ctx, smooth)
    },
    slide(seconds, rate) {
      checked(seconds)
      if (seconds === aimed) return
      aimed = seconds
      const now = ctx.currentTime
      for (const [param, to] of [[first.delayTime, seconds], [again.delayTime, seconds - lag]] as const) {
        // Chrome 149's cancelAndHoldAtTime forgets a setTargetAtTime (observed 2026-10-11).
        const from = param.value
        param.cancelScheduledValues(now)
        param.setValueAtTime(from, now)
        param.linearRampToValueAtTime(to, now + Math.abs(to - from) / rate)
      }
    },
  }
}

export type Echo = { readonly send: GainNode; readonly wet: GainNode; readonly voice: EchoVoice; time(seconds: number, smooth: number): void }

/** Repeats fed back through the voice's filters, the send open from the start when `released`. */
export function echoOf(ctx: BaseAudioContext, from: AudioNode, to: AudioNode, voice: EchoVoice, released: boolean, signal: AbortSignal): Echo {
  const send = new GainNode(ctx, { gain: released ? 1 : 0 })
  const wet = new GainNode(ctx, { gain: released ? 0 : voice.wet })
  const repeats = repeatsOf(ctx, voice.feedback, () => voice.filters.map((options) => new BiquadFilterNode(ctx, options)))
  from.connect(send).connect(repeats.input)
  repeats.output.connect(wet).connect(to)
  signal.addEventListener('abort', () => wet.disconnect(), { once: true })
  return { send, wet, voice, time: repeats.time }
}

/** Decaying noise over `percent` of the largest room, darker as it fades, each channel of unit energy. ASSUMPTION: 0.6 s to 4 s. */
export function impulseOf(ctx: BaseAudioContext, percent: number): AudioBuffer {
  const seconds = 0.6 + 3.4 * (percent / 100)
  const frames = Math.ceil(seconds * ctx.sampleRate)
  const buffer = ctx.createBuffer(2, frames, ctx.sampleRate)
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c)
    let dark = 0
    for (let i = 0; i < frames; i++) {
      const t = i / frames
      const smooth = 0.15 + 0.8 * t
      dark += (Math.random() * 2 - 1 - dark) * (1 - smooth)
      data[i] = dark * Math.exp(-6.9 * t)
    }
    const energy = Math.sqrt(data.reduce((sum, x) => sum + x * x, 0))
    for (let i = 0; i < frames; i++) data[i] = (data[i] ?? 0) / energy
  }
  return buffer
}

type Modulated = { readonly dry: GainNode; readonly wet: GainNode; readonly lfo: OscillatorNode }

/** One flanger sweep per its beats (MAN p.96): a short delay swept by the LFO, fed back. */
export function flangerOf(ctx: BaseAudioContext, from: AudioNode, to: AudioNode): Modulated {
  const dry = new GainNode(ctx)
  const wet = new GainNode(ctx, { gain: 0 })
  const delay = new DelayNode(ctx, { maxDelayTime: 0.02, delayTime: 0.003 })
  const feedback = new GainNode(ctx, { gain: 0.55 })
  const lfo = new OscillatorNode(ctx, { type: 'triangle', frequency: 0.1 })
  const depth = new GainNode(ctx, { gain: 0.0025 })
  from.connect(dry).connect(to)
  from.connect(delay).connect(wet).connect(to)
  delay.connect(feedback).connect(delay)
  lfo.connect(depth).connect(delay.delayTime)
  lfo.start()
  return { dry, wet, lfo }
}

/** One phaser sweep per its beats (MAN p.96): six all-passes swept together. */
export function phaserOf(ctx: BaseAudioContext, from: AudioNode, to: AudioNode): Modulated {
  const dry = new GainNode(ctx)
  const wet = new GainNode(ctx, { gain: 0 })
  const lfo = new OscillatorNode(ctx, { type: 'sine', frequency: 0.1 })
  const depth = new GainNode(ctx, { gain: 1800 })
  const stages = Array.from({ length: 6 }, () => new BiquadFilterNode(ctx, { type: 'allpass', frequency: 900, Q: 0.6 }))
  from.connect(dry).connect(to)
  stages.reduce<AudioNode>((node, stage) => node.connect(stage), from).connect(wet).connect(to)
  lfo.connect(depth)
  for (const stage of stages) depth.connect(stage.detune)
  lfo.start()
  return { dry, wet, lfo }
}

const GLIDE_SECONDS = 0.15

/** Evenly in pitch, so a cutoff sweeps the same speed through every octave. */
export function glide(param: AudioParam, to: number, ctx: BaseAudioContext): void {
  const now = ctx.currentTime
  param.cancelAndHoldAtTime(now)
  param.exponentialRampToValueAtTime(to, now + GLIDE_SECONDS)
}
