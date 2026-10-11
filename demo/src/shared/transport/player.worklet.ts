// Concern: the audio-thread processor playing one deck's song and renders as told, looping, stopping at the end, reporting | Non-concern: the playhead's arithmetic (playhead.ts) | IO: messages -> audio
import { PLAYER, type PlayerMessage, type PlayerReport } from './player-messages.ts'
import { createTransport, declickFor, fadeFor, glideFor, jog, lockedRate, run, seek, setLoop, speedOf, swap, voiceOf, voicesOf } from './playhead.ts'

// The AudioWorkletGlobalScope's names, which TypeScript's DOM library lacks.
declare const sampleRate: number
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void

// A report every 4 blocks of 128 frames: about 94 a second at 48 kHz.
const REPORT_BLOCKS = 4

class Player extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'rate', defaultValue: 1, automationRate: 'k-rate' }]
  }

  #song: Float32Array[] = []
  #voices = voicesOf([])
  #locked = true
  #lockRate = 1
  #transport = createTransport()
  #glide = glideFor(sampleRate)
  #fade = fadeFor(sampleRate)
  #declick = declickFor(sampleRate)
  #blocks = 0

  constructor() {
    super()
    this.port.onmessage = (e: MessageEvent<PlayerMessage>) => this.#told(e.data)
  }

  #told(message: PlayerMessage): void {
    const t = this.#transport
    switch (message.kind) {
      case 'load':
        this.#song = message.song
        this.#voices = voicesOf(message.song)
        t.end = message.song[0]?.length ?? 0
        setLoop(t, null)
        return
      case 'lock':
        if (message.render !== undefined) swap(this.#voices, voiceOf(message.render ?? this.#song, this.#song))
        this.#locked = true
        this.#lockRate = message.rate
        return
      case 'unlock':
        swap(this.#voices, voiceOf(this.#song, this.#song))
        this.#locked = false
        return
      case 'play':
        t.playing = message.on
        return
      case 'reverse':
        t.reverse = message.on
        return
      case 'hold':
        t.held = message.on
        return
      case 'seek':
        seek(t, message.frame)
        return
      case 'jog':
        jog(t, message.frames)
        return
      case 'search':
        t.search = message.speed
        return
      case 'loop':
        setLoop(t, message.loop)
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
    const rate = this.#locked ? lockedRate(this.#voices.now, this.#lockRate) : (parameters.rate?.[0] ?? 1)
    const t = this.#transport
    run(t, this.#voices, outputs[0] ?? [], rate, this.#glide, this.#fade, this.#declick)
    if (t.ended) {
      t.ended = false
      this.port.postMessage({ kind: 'ended' } satisfies PlayerReport)
    }
    if (++this.#blocks % REPORT_BLOCKS === 0) {
      this.port.postMessage({ kind: 'position', position: t.pos, framesASecond: speedOf(t, rate) * sampleRate } satisfies PlayerReport)
    }
    return true
  }
}

registerProcessor(PLAYER, Player)
