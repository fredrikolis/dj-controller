// Concern: the audio-thread effect processor: rolls, brakes, spins, stretch from a ring of the sound, TRANS, CRUSH, ENIGMA JET, PITCH, MOBIUS | Non-concern: the maths | IO: messages, audio -> audio
import { brakeOffset, CRUSH_BITS, CRUSH_HOLD, crushed, grainStart, grainWeight, jetMs, JET_MS, jetWeight, keepsStart, MOBIUS_PARTIALS, mobiusHz, mobiusLevel, rollOffset, SHIFT_SECONDS, shiftDelay, shiftStep, slewed, spinOffset, stopGain, stretchRead, transOpen, waveAt } from './dsp.ts'
import { FX_PROCESSOR, RING_SECONDS, type BufferEffect, type FxMessage, type Wave } from './messages.ts'

declare const sampleRate: number
declare const currentTime: number
declare class AudioWorkletProcessor {
  constructor(options?: AudioWorkletNodeOptions)
  readonly port: MessagePort
}
declare function registerProcessor(name: string, processor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor): void

type Reading = { readonly mode: BufferEffect | null; readonly start: number; readonly frames: number; readonly slow: number }

const LIVE: Reading = { mode: null, start: 0, frames: 0, slow: 1 }
const FADE_FRAMES = 240
// Each roll repeat dips this many frames either side of its seam.
const SEAM_FRAMES = 32
// ASSUMPTION: STRETCH's grains, ENIGMA JET's feedback, MOBIUS's loudness at full LEVEL/DEPTH.
const GRAIN_SECONDS = 0.05
const JET_FEEDBACK = 0.5
const MOBIUS_GAIN = 0.25

const at = (ring: Float32Array, frame: number): number => {
  const n = ring.length
  const whole = Math.floor(frame)
  const a = ring[((whole % n) + n) % n]
  const b = ring[(((whole + 1) % n) + n) % n]
  return a + (b - a) * (frame - whole)
}

class Fx extends AudioWorkletProcessor {
  #channels: number
  #rings: Float32Array[]
  #jetRings: Float32Array[]
  #written = 0
  #reading: Reading = LIVE
  #was: Reading = LIVE
  #fade = 1
  #dry = 0
  #wet = 1
  #dryTold = 0
  #wetTold = 1
  #beat = 0
  #beatsASecond = 2
  #trans: { readonly beats: number; readonly cut: number; readonly open: number } | null = null
  #gate = 1
  #crush = 0
  #pitch = 1
  #pitchMix = 0
  #pitchPhase = 0
  #pitchRings: Float32Array[]
  #pitchFrames = Math.round(SHIFT_SECONDS * sampleRate)
  #crushMix = 0
  #held = 0
  #heldSamples: Float32Array
  #jet: { readonly beats: number; readonly mix: number } | null = null
  #jetMix = 0
  #jetPhase = 0
  #mobius: { readonly beats: number; readonly wave: Wave; readonly level: number } | null = null
  #mobiusLevel = 0
  #wave: Wave = 'saw'
  #octaves = 0
  #partials = new Float64Array(MOBIUS_PARTIALS)
  #grain = Math.round(GRAIN_SECONDS * sampleRate)
  #now = new Float64Array(4)
  #before = new Float64Array(4)
  #smooth = 1 - Math.exp(-1 / (0.001 * sampleRate))
  #slowSmooth = 1 - Math.exp(-1 / (0.01 * sampleRate))

  constructor(options?: AudioWorkletNodeOptions) {
    super(options)
    const channels: unknown = options?.processorOptions?.channels
    if (typeof channels !== 'number' || !Number.isInteger(channels) || channels < 1) throw new RangeError(`the effect processor takes processorOptions.channels, a whole number from 1, not ${String(channels)}`)
    this.#channels = channels
    this.#rings = Array.from({ length: channels }, () => new Float32Array(Math.ceil(RING_SECONDS * sampleRate)))
    this.#jetRings = Array.from({ length: channels }, () => new Float32Array(Math.ceil(((2 * JET_MS[1]) / 1000) * sampleRate)))
    this.#pitchRings = Array.from({ length: channels }, () => new Float32Array(2 * this.#pitchFrames))
    this.#heldSamples = new Float32Array(channels)
    this.port.onmessage = (e: MessageEvent<FxMessage>) => this.#told(e.data)
  }

  #told(message: FxMessage): void {
    switch (message.kind) {
      case 'clock':
        this.#beatsASecond = message.beatsASecond
        if (message.beat !== null) this.#beat = slewed(this.#beat, message.beat + (currentTime - message.at) * message.beatsASecond)
        return
      case 'buffer': {
        const r = this.#reading
        this.#dryTold = message.dry
        this.#wetTold = message.wet
        if (r.mode === message.mode && r.frames === message.frames && r.slow === message.slow) return
        const start = keepsStart(r, message.mode, message.frames) ? r.start : this.#written
        this.#was = r
        this.#reading = message.mode === null ? LIVE : { mode: message.mode, start, frames: message.frames, slow: message.slow }
        this.#fade = 0
        return
      }
      case 'trans':
        this.#trans = message.beats === null ? null : { beats: message.beats, cut: message.cut, open: message.open }
        return
      case 'crush':
        this.#crush = message.mix
        return
      case 'pitch':
        this.#pitch = message.ratio
        return
      case 'jet':
        this.#jet = message.beats === null ? null : { beats: message.beats, mix: message.mix }
        return
      case 'mobius':
        this.#mobius = message.beats === null ? null : { beats: message.beats, wave: message.wave, level: message.level }
        return
    }
  }

  /** Where `r` reads in the ring now and at what gain, into `taps` as frame, gain pairs; how many, 0 where it plays the live sound. */
  #taps(r: Reading, taps: Float64Array): number {
    const elapsed = this.#written - r.start
    switch (r.mode) {
      case null:
        return 0
      case 'roll':
      case 'revRoll':
      case 'slipRoll': {
        if (elapsed < r.frames) return 0
        const into = elapsed % r.frames
        taps[0] = r.start + rollOffset(elapsed, r.frames, r.mode === 'revRoll')
        taps[1] = Math.min(1, into / SEAM_FRAMES, (r.frames - into) / SEAM_FRAMES)
        return 1
      }
      case 'vBrake':
        taps[0] = r.start + brakeOffset(elapsed, r.frames)
        taps[1] = stopGain(elapsed, r.frames)
        return 1
      case 'backSpin':
        taps[0] = r.start + spinOffset(elapsed, r.frames)
        taps[1] = stopGain(elapsed, r.frames)
        return 1
      case 'stretch':
        for (let voice = 0; voice < 2; voice++) {
          const start = grainStart(elapsed, this.#grain, voice)
          taps[2 * voice] = r.start + stretchRead(elapsed, start, r.frames, r.slow)
          taps[2 * voice + 1] = grainWeight(elapsed, start, this.#grain)
        }
        return 2
    }
  }

  #read(ring: Float32Array, taps: Float64Array, count: number, live: number): number {
    if (count === 0) return live
    let sum = 0
    for (let t = 0; t < count; t++) sum += at(ring, taps[2 * t]) * taps[2 * t + 1]
    return this.#wet * sum + this.#dry * live
  }

  #tone(beatStep: number): number {
    const m = this.#mobius
    // A new wave waits for the old one to fade out.
    const turning = m !== null && m.wave !== this.#wave
    if (turning && this.#mobiusLevel < 1e-4) this.#wave = m.wave
    this.#mobiusLevel += ((m && !turning ? m.level : 0) - this.#mobiusLevel) * this.#slowSmooth
    if (this.#mobiusLevel < 1e-5 && !m) return 0
    if (m) this.#octaves += (Math.sign(m.beats) * beatStep) / Math.abs(m.beats)
    let sum = 0
    for (let k = 0; k < MOBIUS_PARTIALS; k++) {
      const step = mobiusHz(this.#octaves, k) / sampleRate
      this.#partials[k] = (this.#partials[k] + step) % 1
      sum += mobiusLevel(this.#octaves, k) * waveAt(this.#wave, this.#partials[k], step)
    }
    return (sum / (MOBIUS_PARTIALS / 2)) * MOBIUS_GAIN * this.#mobiusLevel
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0] ?? []
    const output = outputs[0]
    if (!output || output.length === 0) return true
    const frames = output[0].length
    const n = this.#rings[0].length
    const beatStep = this.#beatsASecond / sampleRate
    const jetN = this.#jetRings[0].length
    for (let i = 0; i < frames; i++) {
      const count = this.#taps(this.#reading, this.#now)
      const fading = this.#fade < 1
      const before = fading ? this.#taps(this.#was, this.#before) : 0
      if (fading) this.#fade = Math.min(1, this.#fade + 1 / FADE_FRAMES)
      const crushing = this.#held++ % CRUSH_HOLD === 0
      this.#crushMix += (this.#crush - this.#crushMix) * this.#smooth
      const t = this.#trans
      const shut = t === null || transOpen(this.#beat, t.beats, t.open) ? 1 : 1 - t.cut
      this.#gate += (shut - this.#gate) * this.#smooth
      const jet = this.#jet
      this.#jetMix += ((jet ? jet.mix : 0) - this.#jetMix) * this.#slowSmooth
      if (jet) this.#jetPhase += (Math.sign(jet.beats) * beatStep) / Math.abs(jet.beats)
      const jetting = this.#jetMix > 1e-5
      const tone = this.#tone(beatStep)
      const shifting = this.#pitch !== 1
      this.#pitchMix += ((shifting ? 1 : 0) - this.#pitchMix) * this.#slowSmooth
      if (shifting) this.#pitchPhase += shiftStep(this.#pitch, this.#pitchFrames)
      const shifted = this.#pitchMix > 1e-5
      const pitchN = 2 * this.#pitchFrames
      this.#dry += (this.#dryTold - this.#dry) * this.#slowSmooth
      this.#wet += (this.#wetTold - this.#wet) * this.#slowSmooth
      for (let c = 0; c < this.#channels; c++) {
        const ring = this.#rings[c]
        const live = input[c]?.[i] ?? 0
        ring[this.#written % n] = live
        let x = this.#read(ring, this.#now, count, live)
        if (fading) x = x * this.#fade + this.#read(ring, this.#before, before, live) * (1 - this.#fade)
        if (crushing) this.#heldSamples[c] = crushed(x, CRUSH_BITS)
        x = x * (1 - this.#crushMix) + this.#heldSamples[c] * this.#crushMix
        x *= this.#gate
        const jetRing = this.#jetRings[c]
        let delayed = 0
        if (jetting) for (let v = 0; v < 2; v++) delayed += at(jetRing, this.#written - (jetMs(this.#jetPhase, v) / 1000) * sampleRate) * jetWeight(this.#jetPhase, v)
        jetRing[this.#written % jetN] = x + JET_FEEDBACK * delayed
        if (jetting) x = x * (1 - this.#jetMix / 2) + delayed * (this.#jetMix / 2)
        const pitchRing = this.#pitchRings[c]
        pitchRing[this.#written % pitchN] = x
        if (shifted) {
          let moved = 0
          for (let v = 0; v < 2; v++) moved += at(pitchRing, this.#written - shiftDelay(this.#pitchPhase, v, this.#pitchFrames)) * jetWeight(this.#pitchPhase, v)
          x = x * (1 - this.#pitchMix) + moved * this.#pitchMix
        }
        output[c][i] = x + tone
      }
      this.#beat += beatStep
      this.#written++
    }
    return true
  }
}

registerProcessor(FX_PROCESSOR, Fx)
