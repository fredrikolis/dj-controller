// Concern: the audio-thread processor of the master's peak limiter, two channels in and out | Non-concern: the arithmetic (limiter.ts) | IO: audio -> audio
import { createLimiter, LIMITER, LIMITER_CHANNELS, type Limiter } from './limiter.ts'

declare const sampleRate: number
declare class AudioWorkletProcessor {}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void

class MasterLimiter extends AudioWorkletProcessor {
  #limiter: Limiter = createLimiter(sampleRate, LIMITER_CHANNELS)

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0] ?? []
    const output = outputs[0] ?? []
    output.forEach((c, i) => {
      const from = input[i]
      if (from) c.set(from)
      else c.fill(0)
    })
    this.#limiter.process(output)
    return true
  }
}

registerProcessor(LIMITER, MasterLimiter)
