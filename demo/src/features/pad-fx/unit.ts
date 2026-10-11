// Concern: one deck's PAD FX in Web Audio: processor, filters, flanger, phaser, echoes, reverb in one chain, set by the effects on and the BPM | Non-concern: which are on | IO: (active, BPM) -> audio
import type { Insert } from '../../shared/engine/engine.ts'
import { beatSeconds } from '../../shared/fx/dsp.ts'
import { RING_SECONDS, type BufferEffect } from '../../shared/fx/messages.ts'
import { ECHOES, echoOf, flangerOf, glide, impulseOf, phaserOf, set, type Echo, type EchoEffect } from '../../shared/fx/nodes.ts'
import { createProcessor } from '../../shared/fx/processor.ts'
import type { Effect, Timing } from './banks.ts'
import { bufferOf, type Active } from './hold.ts'

export type PadFxUnit = Insert & {
  apply(active: readonly Active[], bpm: number): void
  /** Why `active` cannot play at `bpm`, null when it can. */
  refusal(active: readonly Active[], bpm: number): string | null
  /** The deck's beat now, null to let the processor's clock run on, and its BPM. */
  tick(beat: number | null, bpm: number): void
}

const beatsOf = (timing: Timing, effect: Effect): number => {
  if (timing === null || !('beats' in timing)) throw new Error(`${effect} is timed in beats, not ${JSON.stringify(timing)}`)
  return timing.beats
}

const HELD_ECHOES = ['echo', 'lowCutEcho', 'dubEcho'] as const

// ASSUMPTION: FILTER's COLOR (MAN p.101) a third of the way either side, resonant.
const FILTER_ON = { lpf: 500, hpf: 1400 } as const
const FILTER_OFF = { lpf: 20000, hpf: 10 } as const
const FILTER_Q = { lpf: 3, hpf: 1 } as const

/** The chain until `signal` aborts; its processor registered on `ctx` first. */
export function createPadFxUnit(ctx: AudioContext, songBpm: number, signal: AbortSignal): PadFxUnit {
  const input = new GainNode(ctx)
  const output = new GainNode(ctx)
  // The deck's player is mono (createDeck's outputChannelCount).
  const { node: processor, tell } = createProcessor(ctx, 1)
  const hpf = new BiquadFilterNode(ctx, { type: 'highpass', frequency: FILTER_OFF.hpf, Q: FILTER_Q.hpf })
  const lpf = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: FILTER_OFF.lpf, Q: FILTER_Q.lpf })
  const flanged = new GainNode(ctx)
  const shaped = new GainNode(ctx)
  input.connect(processor).connect(hpf).connect(lpf)
  const flanger = flangerOf(ctx, lpf, flanged)
  const phaser = phaserOf(ctx, flanged, shaped)
  const dry = new GainNode(ctx)
  shaped.connect(dry).connect(output)
  const echo = (effect: EchoEffect) => echoOf(ctx, shaped, output, ECHOES[effect], effect === 'releaseEcho', signal)
  const echoes: Record<EchoEffect, Echo> = { echo: echo('echo'), lowCutEcho: echo('lowCutEcho'), dubEcho: echo('dubEcho'), releaseEcho: echo('releaseEcho') }
  const reverbSend = new GainNode(ctx, { gain: 0 })
  const convolver = new ConvolverNode(ctx)
  const reverbReturn = new GainNode(ctx, { gain: 0.6 })
  shaped.connect(reverbSend).connect(convolver).connect(reverbReturn).connect(output)
  const impulses = new Map<number, AudioBuffer>()

  let sent = { mode: null as BufferEffect | null, frames: 0, trans: null as number | null, crush: false }
  let on: readonly Active[] = []
  // ASSUMPTION: at 0 BPM (WIDE's bottom) the effects keep the last BPM's timing.
  let bpm = songBpm

  const timed = (effect: Effect): number | null => {
    const a = on.findLast((x) => x.effect === effect)
    return a ? beatsOf(a.timing, effect) * beatSeconds(bpm) : null
  }

  // Whatever follows the BPM: echo times, sweep rates.
  function follow(): void {
    for (const effect of [...HELD_ECHOES, 'releaseEcho'] as const) {
      const seconds = timed(effect)
      if (seconds !== null) echoes[effect].time(seconds, 0.05)
    }
    for (const [effect, unit] of [['flanger', flanger], ['phaser', phaser]] as const) {
      const seconds = timed(effect)
      if (seconds !== null) set(unit.lfo.frequency, 1 / seconds, ctx, 0.05)
    }
  }

  const bufferFrames = (active: readonly Active[], atBpm: number) => {
    const buffer = bufferOf(active)
    return { mode: buffer?.effect ?? null, frames: buffer ? Math.round(buffer.beats * beatSeconds(atBpm) * ctx.sampleRate) : 0 }
  }
  const refusal = (active: readonly Active[], atBpm: number): string | null => {
    const { mode, frames } = bufferFrames(active, atBpm > 0 ? atBpm : bpm)
    const most = RING_SECONDS * ctx.sampleRate
    return frames > most ? `${mode} over ${(frames / ctx.sampleRate).toFixed(1)} s at ${atBpm.toFixed(1)} BPM reads past the ${RING_SECONDS} s of sound the PAD FX processor keeps` : null
  }

  signal.addEventListener(
    'abort',
    () => {
      flanger.lfo.stop()
      phaser.lfo.stop()
      processor.port.close()
      output.disconnect()
    },
    { once: true },
  )

  return {
    input,
    output,
    apply(active, atBpm) {
      on = active
      if (atBpm > 0) bpm = atBpm
      const has = (effect: Effect) => active.some((a) => a.effect === effect)
      const refused = refusal(active, bpm)
      if (refused !== null) throw new RangeError(`${refused}; a hold must be refused before it reaches the unit`)
      const { mode, frames } = bufferFrames(active, bpm)
      if (mode !== sent.mode || frames !== sent.frames) tell({ kind: 'buffer', mode, frames, slow: 1, dry: 0, wet: 1 })
      const trans = active.findLast((a) => a.effect === 'trans')
      const transBeats = trans ? beatsOf(trans.timing, 'trans') : null
      if (transBeats !== sent.trans) tell({ kind: 'trans', beats: transBeats, cut: 1, open: 0.5 })
      if (has('crush') !== sent.crush) tell({ kind: 'crush', on: has('crush') })
      sent = { mode, frames, trans: transBeats, crush: has('crush') }
      glide(lpf.frequency, has('lpf') ? FILTER_ON.lpf : FILTER_OFF.lpf, ctx)
      glide(hpf.frequency, has('hpf') ? FILTER_ON.hpf : FILTER_OFF.hpf, ctx)
      for (const [effect, unit] of [['flanger', flanger], ['phaser', phaser]] as const) {
        set(unit.wet.gain, has(effect) ? 0.7 : 0, ctx)
        set(unit.dry.gain, has(effect) ? 0.7 : 1, ctx)
      }
      // ASSUMPTION: a DJM echo's trail: off closes the send and the repeats ring out.
      for (const effect of HELD_ECHOES) set(echoes[effect].send.gain, has(effect) ? 1 : 0, ctx)
      // RB p.185: the original sound gives way to the echo of what was just playing, back once let go.
      const releasing = has('releaseEcho')
      set(echoes.releaseEcho.send.gain, releasing ? 0 : 1, ctx, 0.02)
      set(echoes.releaseEcho.wet.gain, releasing ? echoes.releaseEcho.voice.wet : 0, ctx, releasing ? 0.005 : 0.03)
      set(dry.gain, releasing ? 0 : 1, ctx, 0.005)
      const reverb = active.findLast((a) => a.effect === 'reverb')
      if (reverb) {
        const percent = reverb.timing !== null && 'percent' in reverb.timing ? reverb.timing.percent : null
        if (percent === null) throw new Error(`REVERB is sized in percent (MAN p.95), not ${JSON.stringify(reverb.timing)}`)
        const impulse = impulses.get(percent) ?? impulseOf(ctx, percent)
        impulses.set(percent, impulse)
        if (convolver.buffer !== impulse) convolver.buffer = impulse
      }
      set(reverbSend.gain, reverb ? 1 : 0, ctx)
      follow()
    },
    refusal,
    tick(beat, atBpm) {
      tell({ kind: 'clock', beat, beatsASecond: atBpm / 60, at: ctx.currentTime })
      if (!(atBpm > 0) || Math.abs(atBpm - bpm) < 0.01) return
      bpm = atBpm
      follow()
    },
  }
}
