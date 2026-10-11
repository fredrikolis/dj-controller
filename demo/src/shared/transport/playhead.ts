// Concern: a deck's playhead and what it reads: advanced either way, held, jogged, searched, sought, glided, looped, the ends stopping, fades | Non-concern: the worklet | IO: transport -> frames
import type { LoopPoints } from './loop-state.ts'

/** In frames of the loaded song; `level` follows speed, so a held deck falls silent. */
export type Transport = {
  target: number
  pos: number
  level: number
  playing: boolean
  reverse: boolean
  held: boolean
  search: number
  loop: LoopPoints | null
  end: number
  ended: boolean
  sinceWrap: number
}

/** `scale`: frames of `song` per frame of the loaded song. */
export type Voice = { readonly song: readonly Float32Array[]; readonly scale: number }

export type Voices = { now: Voice; was: Voice | null; fade: number }

export type Declick = number

const GLIDE_SECS = 0.01
const FADE_SECS = 0.01
// ASSUMPTION: a wrap dips out and in, 0.5 ms each side.
const DECLICK_HALF_SECS = 0.0005
// Frames a frame for full level.
const FULL_LEVEL_SPEED = 0.25

export const createTransport = (): Transport => ({ target: 0, pos: 0, level: 0, playing: false, reverse: false, held: false, search: 0, loop: null, end: 0, ended: false, sinceWrap: Infinity })

export const glideFor = (sampleRate: number): number => 1 - Math.exp(-1 / (GLIDE_SECS * sampleRate))

export const fadeFor = (sampleRate: number): number => 1 / (FADE_SECS * sampleRate)

export const declickFor = (sampleRate: number): Declick => DECLICK_HALF_SECS * sampleRate

export const voicesOf = (song: readonly Float32Array[]): Voices => ({ now: { song, scale: 1 }, was: null, fade: 1 })

export function voiceOf(song: readonly Float32Array[], loaded: readonly Float32Array[]): Voice {
  const frames = loaded[0]?.length ?? 0
  return { song, scale: frames === 0 ? 1 : (song[0]?.length ?? 0) / frames }
}

/** Frames of the loaded song a frame, key-locked: a render at twice the tempo is half as long, read at half the rate, slower still at `rate` of its tempo. */
export const lockedRate = (voice: Voice, rate: number): number => rate / voice.scale

export function swap(voices: Voices, next: Voice): void {
  voices.was = voices.now
  voices.now = next
  voices.fade = 0
}

export function seek(t: Transport, frame: number): void {
  t.target = frame
  t.pos = frame
}

export const speedOf = (t: Transport, rate: number): number => (t.playing && !t.held ? (t.reverse ? -rate : rate) : 0) + t.search

export function jog(t: Transport, frames: number): void {
  t.target += frames
}

// Target moves with the playhead, so the glide never smears a wrap.
function fold(t: Transport, { in: start, out }: LoopPoints): void {
  const len = out - start
  // ASSUMPTION: reversed, in wraps.
  if (len <= 0 || (t.pos < out && !(t.reverse && t.pos < start))) return
  const back = Math.floor((t.pos - start) / len) * len
  t.pos -= back
  t.target -= back
  t.sinceWrap = 0
}

export function setLoop(t: Transport, loop: LoopPoints | null): void {
  t.loop = loop
  if (loop && t.pos >= loop.in) fold(t, loop)
}

function read(x: Float32Array, pos: number): number {
  if (!(pos >= 0 && pos < x.length)) return 0
  const i = Math.floor(pos)
  const f = pos - i
  return (x[i] ?? 0) * (1 - f) + (x[i + 1] ?? 0) * f
}

function sample(voice: Voice, channel: number, pos: number): number {
  const x = voice.song[Math.min(channel, voice.song.length - 1)]
  return x?.length ? read(x, pos * voice.scale) : 0
}

const inside = (t: Transport): boolean => t.loop !== null && t.pos >= t.loop.in && t.pos < t.loop.out

function stop(t: Transport): void {
  if (t.playing) t.ended = true
  t.playing = false
}

// ASSUMPTION: the end stops, and reversed the start.
function bound(t: Transport): void {
  const last = Math.max(0, t.end - 1)
  if (t.pos < 0) {
    seek(t, 0)
    t.search = Math.max(0, t.search)
    if (t.reverse) stop(t)
  }
  if (t.end === 0 || t.pos < last || inside(t)) return
  seek(t, last)
  t.search = Math.min(0, t.search)
  if (!t.reverse) stop(t)
}

function declick(t: Transport, frames: Declick): number {
  if (!t.loop || !inside(t) || frames <= 0) return 1
  return Math.max(0, Math.min(1, (t.reverse ? t.pos - t.loop.in : t.loop.out - t.pos) / frames, t.sinceWrap / frames))
}

export function run(t: Transport, voices: Voices, out: Float32Array[], rate: number, glide: number, fade: number, dip: Declick): void {
  const frames = out[0]?.length ?? 0
  for (let i = 0; i < frames; i++) {
    t.target += speedOf(t, rate)
    const step = (t.target - t.pos) * glide
    const before = t.pos
    t.pos += step
    t.sinceWrap++
    // ASSUMPTION: only crossing out from inside wraps.
    if (t.loop && before >= t.loop.in && before < t.loop.out) fold(t, t.loop)
    bound(t)
    t.level += (Math.min(1, Math.abs(step) / FULL_LEVEL_SPEED) - t.level) * glide
    const was = voices.was
    if (was) voices.fade = Math.min(1, voices.fade + fade)
    const gain = t.level * declick(t, dip)
    out.forEach((channel, c) => {
      const now = sample(voices.now, c, t.pos)
      channel[i] = (was ? now * voices.fade + sample(was, c, t.pos) * (1 - voices.fade) : now) * gain
    })
    if (voices.fade === 1) voices.was = null
  }
}
