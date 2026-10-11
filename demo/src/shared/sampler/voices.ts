// Concern: the sampler in Web Audio: a player a position, faded in at an offset, loops at the BPM's rate, swapped to new renders in phase; GAIN | Non-concern: what plays | IO: (starts, BPM) -> audio
import type { Slot } from './banks.ts'
import { rateOf } from './clock.ts'
import type { Sound, Sounds } from './renders.ts'
import type { Voice } from './sampler-state.ts'

/** How a voice starts: its slot, its sound, seconds into it. */
export type Start = { readonly slot: Slot; readonly sound: Sound; readonly offset: number }

/** The audio of SamplerState.voices, reconciled with them at each change. */
export type Voices = {
  apply(voices: readonly (Voice | null)[], bpm: number, startOf: (voice: Voice) => Start): void
  /** Each playing loop's node. */
  loops(): ReadonlySet<string>
  follow(bpm: number): void
  swap(sounds: Sounds, bpm: number): void
  levels(gain: number, volume: number): void
}

// ASSUMPTION: no click; a swap scheduled ahead so it lands in phase.
const FADE = 0.003
const LEAD = 0.05

type Player = {
  readonly id: number
  readonly slot: Slot
  readonly sound: Sound
  readonly source: AudioBufferSourceNode
  readonly fade: GainNode
  /** Where in the buffer it read at `time`, moving at `rate`. */
  anchor: { time: number; at: number; rate: number }
}

const readAt = (p: Player, time: number): number => {
  const at = p.anchor.at + (time - p.anchor.time) * p.anchor.rate
  return p.slot.mode === 'loop' ? at % p.sound.buffer.duration : at
}

export function createVoices(ctx: AudioContext, master: AudioNode, ended: (id: number) => void, signal: AbortSignal): Voices {
  const gain = new GainNode(ctx)
  const volume = new GainNode(ctx)
  gain.connect(volume).connect(master)
  const players = new Map<number, Player>()

  const fadeOut = (p: Player, time: number) => {
    p.fade.gain.setValueAtTime(1, time)
    p.fade.gain.linearRampToValueAtTime(0, time + FADE)
    p.source.stop(time + FADE)
  }

  const play = (position: number, id: number, slot: Slot, sound: Sound, rate: number, offset: number, time: number): Player => {
    const source = new AudioBufferSourceNode(ctx, { buffer: sound.buffer, loop: slot.mode === 'loop', playbackRate: rate })
    const fade = new GainNode(ctx, { gain: 0 })
    source.connect(fade).connect(gain)
    fade.gain.setValueAtTime(0, time)
    fade.gain.linearRampToValueAtTime(1, time + FADE)
    const player: Player = { id, slot, sound, source, fade, anchor: { time, at: offset, rate } }
    source.onended = () => {
      fade.disconnect()
      if (players.get(position) !== player) return
      players.delete(position)
      ended(id)
    }
    source.start(time, offset)
    players.set(position, player)
    return player
  }

  const stop = (position: number) => {
    const p = players.get(position)
    if (!p) return
    players.delete(position)
    fadeOut(p, ctx.currentTime)
  }

  signal.addEventListener(
    'abort',
    () => {
      for (const position of [...players.keys()]) stop(position)
      volume.disconnect()
    },
    { once: true },
  )

  return {
    apply(voices, bpm, startOf) {
      voices.forEach((voice, position) => {
        if (voice === null) return stop(position)
        if (players.get(position)?.id === voice.id) return
        stop(position)
        const { slot, sound, offset } = startOf(voice)
        play(position, voice.id, slot, sound, slot.mode === 'loop' ? rateOf(bpm, sound.bpm) : 1, offset, ctx.currentTime)
      })
    },
    loops: () => new Set([...players.values()].filter((p) => p.slot.mode === 'loop').map((p) => p.slot.node)),
    follow(bpm) {
      const now = ctx.currentTime
      for (const p of players.values()) {
        if (p.slot.mode !== 'loop') continue
        const rate = rateOf(bpm, p.sound.bpm)
        p.anchor = { time: now, at: readAt(p, now), rate }
        p.source.playbackRate.setValueAtTime(rate, now)
      }
    },
    swap(sounds, bpm) {
      const time = ctx.currentTime + LEAD
      for (const [position, p] of players) {
        const sound = sounds.get(p.slot.node)
        if (p.slot.mode !== 'loop' || !sound || sound === p.sound) continue
        const offset = (readAt(p, time) / p.sound.buffer.duration) * sound.buffer.duration
        fadeOut(p, time)
        play(position, p.id, p.slot, sound, rateOf(bpm, sound.bpm), offset, time)
      }
    },
    levels(g, v) {
      gain.gain.setTargetAtTime(g, ctx.currentTime, 0.01)
      volume.gain.setTargetAtTime(v, ctx.currentTime, 0.01)
    },
  }
}
