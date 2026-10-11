// Concern: the Beat FX unit in stereo Web Audio: processor, flanger, phaser, echoes, multi-tap, spiral, reverb, Release FX | Non-concern: the rules, the routing | IO: (state, BPM) -> audio
import type { Insert } from '../../shared/engine/engine.ts'
import { balanceOf, beatSeconds, transCutOf } from '../../shared/fx/dsp.ts'
import { DELAY_SECONDS, type FxMessage } from '../../shared/fx/messages.ts'
import { ECHOES, echoOf, flangerOf, impulseOf, phaserOf, repeatsOf, set, type Echo, type Repeats } from '../../shared/fx/nodes.ts'
import { createProcessor } from '../../shared/fx/processor.ts'
import { logger } from '../../shared/logger.ts'
import { BALANCED, type BeatFx } from './effects.ts'
import { activeOf, refusal, type BeatFxState } from './unit-state.ts'

export type BeatFxUnit = Insert & {
  apply(state: BeatFxState, bpm: number): void
  /** The beat TRANS cuts in phase with, null to let the processor's clock run on. */
  tick(beat: number | null, bpm: number): void
}

const CHANNELS = 2
// MAN p.94: up to 7 repeats in 1/8 units of the effect time. ASSUMPTION: each quieter, through the echo's filters, together about the dry sound's level.
const TAPS = 7
const TAPS_LEVEL = 0.55
// MAN p.95: the pitch changes with the delay time. ASSUMPTION: the time moves at half real time, so its sound plays a fifth up or an octave down meanwhile.
const SPIRAL_SLIDE = 0.5
// ASSUMPTION: SPIRAL's feedback from LEVEL/DEPTH's bottom to its top; its trail rings out at the bottom's.
const SPIRAL_FEEDBACK = [0.45, 0.85] as const
// ASSUMPTION: REVERB at full LEVEL/DEPTH about as loud as the sound it takes; a new size fades in over this.
const REVERB_LEVEL = 1.1
const REVERB_FADE = 0.06

type Taps = { readonly send: GainNode; readonly delays: readonly DelayNode[]; readonly wet: GainNode }

function multiTapOf(ctx: BaseAudioContext, from: AudioNode, to: AudioNode): Taps {
  const send = new GainNode(ctx, { gain: 0 })
  const wet = new GainNode(ctx, { gain: 0 })
  const tone = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 150 })
  from.connect(send)
  tone.connect(wet).connect(to)
  const delays = Array.from({ length: TAPS }, (_, k) => {
    const delay = new DelayNode(ctx, { maxDelayTime: DELAY_SECONDS, delayTime: 0.1 })
    send.connect(delay).connect(new GainNode(ctx, { gain: 0.9 - (0.7 * k) / TAPS })).connect(tone)
    return delay
  })
  return { send, delays, wet }
}

type Spiral = { readonly send: GainNode; readonly repeats: Repeats; readonly wet: GainNode }

// MAN p.95: a reverb whose pitch bends as its delay time moves. ASSUMPTION: each pass smeared by all-passes, none louder than it came in.
const SPIRAL_SMEAR = [220, 480, 950, 1900, 3600, 6200] as const

function spiralOf(ctx: BaseAudioContext, from: AudioNode, to: AudioNode): Spiral {
  const send = new GainNode(ctx, { gain: 0 })
  const wet = new GainNode(ctx, { gain: 0 })
  // A low-pass's Q is in dB: -3 is the flattest, so no frequency grows round the loop.
  const repeats = repeatsOf(ctx, SPIRAL_FEEDBACK[0], () => [...SPIRAL_SMEAR.map((frequency) => new BiquadFilterNode(ctx, { type: 'allpass', frequency, Q: 2.5 })), new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 7000, Q: -3 })])
  from.connect(send).connect(repeats.input)
  repeats.output.connect(wet).connect(to)
  return { send, repeats, wet }
}

type Reverb = { size(percent: number): void; send(level: number): void }

/** Two convolvers: a new size fades in on the idle one while the other's tail rings out. */
function reverbOf(ctx: BaseAudioContext, from: AudioNode, to: AudioNode): Reverb {
  const back = new GainNode(ctx, { gain: REVERB_LEVEL })
  back.connect(to)
  const rooms = [0, 1].map(() => {
    const send = new GainNode(ctx, { gain: 0 })
    const room = new ConvolverNode(ctx, { disableNormalization: true })
    from.connect(send).connect(room).connect(back)
    return { send, room }
  })
  const impulses = new Map<number, AudioBuffer>()
  let live = 0
  let sized: number | null = null
  let level = 0
  return {
    size(percent) {
      if (percent === sized) return
      const impulse = impulses.get(percent) ?? impulseOf(ctx, percent)
      impulses.set(percent, impulse)
      if (sized !== null) {
        set(rooms[live].send.gain, 0, ctx, REVERB_FADE / 3)
        live = 1 - live
      }
      rooms[live].room.buffer = impulse
      set(rooms[live].send.gain, level, ctx, REVERB_FADE / 3)
      sized = percent
    },
    send(to) {
      level = to
      set(rooms[live].send.gain, to, ctx)
    },
  }
}

const same = (a: FxMessage | undefined, b: FxMessage) => a !== undefined && JSON.stringify(a) === JSON.stringify(b)

/** The chain until `signal` aborts; its processor registered on `ctx` first. */
export function createBeatFxUnit(ctx: AudioContext, signal: AbortSignal): BeatFxUnit {
  const input = new GainNode(ctx, { channelCount: CHANNELS, channelCountMode: 'explicit' })
  const output = new GainNode(ctx)
  const { node: processor, tell } = createProcessor(ctx, CHANNELS)
  const flanged = new GainNode(ctx)
  const shaped = new GainNode(ctx)
  input.connect(processor)
  const flanger = flangerOf(ctx, processor, flanged)
  const phaser = phaserOf(ctx, flanged, shaped)
  const dry = new GainNode(ctx)
  shaped.connect(dry).connect(output)
  const echo = (voice: keyof typeof ECHOES) => echoOf(ctx, shaped, output, ECHOES[voice], voice === 'releaseEcho', signal)
  const echoes: Readonly<Record<'lowCutEcho' | 'echo' | 'releaseEcho', Echo>> = { lowCutEcho: echo('lowCutEcho'), echo: echo('echo'), releaseEcho: echo('releaseEcho') }
  const taps = multiTapOf(ctx, shaped, output)
  const spiral = spiralOf(ctx, shaped, output)
  const reverb = reverbOf(ctx, shaped, output)
  const sent: Partial<Record<FxMessage['kind'], FxMessage>> = {}
  const send = (message: FxMessage) => {
    if (same(sent[message.kind], message)) return
    sent[message.kind] = message
    tell(message)
  }
  // ASSUMPTION: at 0 BPM (WIDE's bottom) the effect keeps the last BPM's timing, as PAD FX.
  let bpm = 120
  let last: BeatFxState | null = null
  let drifted = false
  let spiralling = false

  function timed(s: BeatFxState): void {
    const on = activeOf(s)
    const seconds = (beats: number) => Math.abs(beats) * beatSeconds(bpm)
    if (s.release.held && s.release.type === 'releaseEcho') echoes.releaseEcho.time(seconds(s.release.beats), 0.05)
    if (on !== null) {
      const time = seconds(on.value)
      if (on.effect === 'lowCutEcho' || on.effect === 'echo') echoes[on.effect].time(time, 0.05)
      if (on.effect === 'mtDelay') taps.delays.forEach((d, k) => set(d.delayTime, ((k + 1) / (TAPS + 1)) * time, ctx, 0.05))
      if (on.effect === 'spiral') spiralling ? spiral.repeats.slide(time, SPIRAL_SLIDE) : spiral.repeats.time(time, 0.005)
      if (on.effect === 'flanger' || on.effect === 'phaser') set((on.effect === 'flanger' ? flanger : phaser).lfo.frequency, 1 / time, ctx, 0.05)
    }
    const frames = (beats: number) => Math.round(seconds(beats) * ctx.sampleRate)
    const buffer = (): FxMessage => {
      const { dry: d, wet: w } = balanceOf(s.depth)
      if (s.release.held && s.release.type !== 'releaseEcho') return { kind: 'buffer', mode: s.release.type, frames: frames(s.release.beats), slow: 1, dry: 0, wet: 1 }
      if (on?.effect === 'roll' || on?.effect === 'slipRoll') return { kind: 'buffer', mode: on.effect, frames: frames(on.value), slow: 1, dry: d, wet: w }
      // MAN p.96. ASSUMPTION: LEVEL/DEPTH plays the recording 1x to 8x slower.
      if (on?.effect === 'stretch') return { kind: 'buffer', mode: 'stretch', frames: frames(on.value), slow: 2 ** (3 * s.depth), dry: 0, wet: 1 }
      return { kind: 'buffer', mode: null, frames: 0, slow: 1, dry: 0, wet: 1 }
    }
    send(buffer())
  }

  function apply(s: BeatFxState): void {
    const on = activeOf(s)
    const is = (effect: BeatFx) => on?.effect === effect
    const { dry: d, wet: w } = balanceOf(s.depth)
    const releasing = s.release.held && s.release.type === 'releaseEcho'
    set(dry.gain, releasing ? 0 : on && BALANCED.has(on.effect) && !is('roll') && !is('slipRoll') ? d : 1, ctx, releasing ? 0.005 : undefined)
    // ASSUMPTION: a DJM's trails: off shuts the send and the repeats ring out.
    for (const voice of ['lowCutEcho', 'echo'] as const) {
      set(echoes[voice].send.gain, is(voice) ? 1 : 0, ctx)
      if (is(voice)) set(echoes[voice].wet.gain, ECHOES[voice].wet * w, ctx)
    }
    set(echoes.releaseEcho.send.gain, releasing ? 0 : 1, ctx, 0.02)
    set(echoes.releaseEcho.wet.gain, releasing ? ECHOES.releaseEcho.wet : 0, ctx, releasing ? 0.005 : 0.03)
    set(taps.send.gain, is('mtDelay') ? 1 : 0, ctx)
    if (is('mtDelay')) set(taps.wet.gain, TAPS_LEVEL * w, ctx)
    set(spiral.send.gain, is('spiral') ? 1 : 0, ctx)
    if (is('spiral')) set(spiral.wet.gain, w, ctx)
    set(spiral.repeats.feedback.gain, SPIRAL_FEEDBACK[0] + (is('spiral') ? (SPIRAL_FEEDBACK[1] - SPIRAL_FEEDBACK[0]) * s.depth : 0), ctx)
    if (is('reverb') && on) reverb.size(on.value)
    reverb.send(is('reverb') ? w : 0)
    for (const [effect, unit] of [['flanger', flanger], ['phaser', phaser]] as const) {
      set(unit.wet.gain, is(effect) ? 0.7 * s.depth : 0, ctx)
      set(unit.dry.gain, is(effect) ? 1 - 0.3 * s.depth : 1, ctx)
    }
    send(is('trans') && on ? { kind: 'trans', beats: on.value, ...transCutOf(s.depth) } : { kind: 'trans', beats: null, cut: 0, open: 0.5 })
    send(is('enigmaJet') && on ? { kind: 'jet', beats: on.value, mix: s.depth } : { kind: 'jet', beats: null, mix: 0 })
    const mobius = on && (on.effect === 'mobiusSaw' || on.effect === 'mobiusTri') ? on : null
    send(mobius ? { kind: 'mobius', beats: mobius.value, wave: mobius.effect === 'mobiusSaw' ? 'saw' : 'tri', level: s.depth } : { kind: 'mobius', beats: null, wave: 'saw', level: 0 })
    timed(s)
    spiralling = is('spiral')
  }

  signal.addEventListener(
    'abort',
    () => {
      flanger.lfo.stop()
      phaser.lfo.stop()
      processor.port.close()
    },
    { once: true },
  )

  return {
    input,
    output,
    apply(s, atBpm) {
      const refused = refusal(s, atBpm > 0 ? atBpm : bpm)
      if (refused !== null) throw new RangeError(`${refused}; a change must be refused before it reaches the unit`)
      if (atBpm > 0) bpm = atBpm
      last = s
      apply(s)
    },
    tick(beat, atBpm) {
      if (atBpm > 0 && Math.abs(atBpm - bpm) >= 0.01 && last !== null) {
        const refused = refusal(last, atBpm)
        if (refused === null) {
          bpm = atBpm
          drifted = false
          timed(last)
        } else if (!drifted) {
          drifted = true
          logger.error('the Beat FX keeps its last timing', new RangeError(`${refused}; the unit keeps ${bpm.toFixed(1)} BPM's timing until the BPM fits again`))
        }
      }
      tell({ kind: 'clock', beat, beatsASecond: bpm / 60, at: ctx.currentTime })
    },
  }
}
