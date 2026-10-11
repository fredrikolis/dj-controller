// Concern: checks what a deck plays: the tempo's speed, silence held, a jog, a search, a render swapped in phase, loops wrapped at the sample, the end | Non-concern: the audio thread | IO: none
import assert from 'node:assert/strict'
import test from 'node:test'
import type { LoopPoints } from './loop-state.ts'
import { createTransport, declickFor, fadeFor, glideFor, jog, lockedRate, run, seek, setLoop, speedOf, swap, voiceOf, voicesOf, type Transport, type Voices } from './playhead.ts'

const RATE = 48000
// 144 BPM at 48 kHz, as the loops spec's boundary tests: a beat is 20000 frames.
const BEAT = 20000
const glide = glideFor(RATE)
const fade = fadeFor(RATE)
const dip = declickFor(RATE)
// A ramp: each frame's value is its own index, so what plays says where it reads.
const ramp = [Float32Array.from({ length: 4 * RATE }, (_, i) => i)]

function play(t: Transport, frames: number, rate = 1, voices: Voices = voicesOf(ramp)): Float32Array {
  const out = new Float32Array(frames)
  run(t, voices, [out], rate, glide, fade, dip)
  return out
}

/** Plays one frame at a time, giving the playhead after each. */
function positions(t: Transport, frames: number, rate = 1, voices: Voices = voicesOf(ramp)): number[] {
  return Array.from({ length: frames }, () => {
    play(t, 1, rate, voices)
    return t.pos
  })
}

function playingAt(frame: number, loop: LoopPoints | null = null): Transport {
  const t = createTransport()
  t.end = ramp[0]?.length ?? 0
  seek(t, frame)
  setLoop(t, loop)
  t.playing = true
  return t
}

const last = (x: Float32Array, back = 1): number => x[x.length - back]

const within = (frames: readonly number[], { in: start, out }: LoopPoints): boolean => frames.every((p) => p >= start && p < out)

test('playing reads the song at the tempo’s speed', () => {
  const t = playingAt(0)
  const out = play(t, RATE / 2, 1.08)
  assert.ok(Math.abs(last(out) - last(out, 2) - 1.08) < 1e-3)
})

test('a held deck falls silent, and plays on from where a jog moved it', () => {
  const t = playingAt(0)
  const before = last(play(t, RATE / 2))
  t.held = true
  assert.ok(Math.abs(last(play(t, RATE / 2))) < 1e-3)
  jog(t, RATE / 4)
  t.held = false
  const after = last(play(t, RATE / 2))
  assert.ok(Math.abs(after - (before + RATE / 4 + RATE / 2)) < RATE / 100)
})

test('a render at twice the tempo, swapped in, plays on from the same point of the song at its own speed', () => {
  // Each frame's value is how far through the song it lies.
  const song = (frames: number) => [Float32Array.from({ length: frames }, (_, i) => i / frames)]
  const loaded = song(4 * RATE)
  const voices = voicesOf(loaded)
  const t = playingAt(0)
  const before = last(play(t, RATE / 2, 1, voices))
  const faster = voiceOf(song(2 * RATE), loaded)
  swap(voices, faster)
  const after = play(t, RATE / 2, 1 / faster.scale, voices)
  assert.ok(Math.abs(after[0] - before) < 1e-4)
  assert.ok(Math.abs(last(after) - last(after, 2) - 1 / (2 * RATE)) < 1e-6)
})

// T9: the glide never carries the playhead past out.
test('a 1/64-beat loop played for a second reads only frames inside it, wrapping every 312.5 frames', () => {
  const loop = { in: BEAT, out: BEAT + BEAT / 64 }
  const t = playingAt(loop.in, loop)
  const read = positions(t, RATE)
  assert.ok(within(read, loop))
  const wraps = read.filter((p, i) => i > 0 && p < (read[i - 1] ?? 0)).length
  // The glide's first 10 ms, gathering speed from the seek, costs it under two wraps.
  assert.ok(Math.abs(wraps - RATE / (BEAT / 64)) <= 2)
})

// T9: a ramp looped from 0 jumps by the whole loop at each wrap without the dip.
test('each wrap dips out and back in, so no step is a click', () => {
  const loop = { in: 0, out: BEAT / 64 }
  const t = playingAt(0, loop)
  play(t, RATE / 2)
  const out = play(t, RATE / 2)
  const steps = out.slice(1).map((v, i) => Math.abs(v - (out[i] ?? 0)))
  assert.ok(Math.max(...steps) < (loop.out - loop.in) / 8)
  assert.ok(out.every((v) => v < loop.out))
})

// T10
test('a TEMPO of 1.08 and a key-lock render swapped in mid-loop keep its points and wrap at out', () => {
  const song = (frames: number) => [Float32Array.from({ length: frames }, (_, i) => i / frames)]
  const loaded = song(4 * RATE)
  const voices = voicesOf(loaded)
  const loop = { in: BEAT, out: 2 * BEAT }
  const t = playingAt(loop.in, loop)
  const unlocked = positions(t, RATE / 2, 1.08, voices)
  const faster = voiceOf(song(2 * RATE), loaded)
  swap(voices, faster)
  const locked = positions(t, RATE / 2, 1 / faster.scale, voices)
  assert.deepEqual(t.loop, loop)
  assert.ok(within([...unlocked, ...locked], loop))
  assert.ok(locked.some((p, i) => i > 0 && p < (locked[i - 1] ?? 0)), 'it wraps after the swap')
})

test('key-locked, a render at half the tempo read at half its rate plays the loaded song at a quarter, the render at half', () => {
  const loaded = [Float32Array.from({ length: RATE }, (_, i) => i)]
  const voices = voicesOf(loaded)
  const slowest = voiceOf([Float32Array.from({ length: 2 * RATE }, (_, i) => i)], loaded)
  swap(voices, slowest)
  const t = playingAt(0)
  const rate = lockedRate(slowest, 0.5)
  play(t, RATE / 2, rate, voices)
  assert.equal(rate, 0.25)
  assert.ok(Math.abs(t.pos - RATE / 8) < 0.25 * 0.01 * RATE, 'a quarter of the loaded song’s frames, within the glide’s lag')
  assert.equal(lockedRate(slowest, 1), 0.5, 'at its own tempo, half')
})

// T11
test('a jog nudge across out wraps to in', () => {
  const loop = { in: BEAT, out: 2 * BEAT }
  const t = playingAt(2 * BEAT - 1000, loop)
  t.playing = false
  jog(t, 2000)
  play(t, RATE / 10)
  assert.ok(Math.abs(t.pos - (loop.in + 1000)) < 1)
})

// T2, T6: a snapped out behind the playhead, or a halve leaving it past the new out, keeps the beat.
test('a loop set with the playhead past its out folds the playhead in by whole lengths, keeping its phase', () => {
  const t = playingAt(3 * BEAT + 500)
  setLoop(t, { in: 2 * BEAT, out: 3 * BEAT })
  assert.equal(t.pos, 2 * BEAT + 500)
  const halved = playingAt(BEAT + 70000)
  setLoop(halved, { in: BEAT, out: BEAT + 2 * BEAT })
  assert.equal(halved.pos, BEAT + 30000)
  const before = playingAt(BEAT / 2)
  setLoop(before, { in: BEAT, out: 2 * BEAT })
  assert.equal(before.pos, BEAT / 2, 'a playhead before in plays into the loop')
})

// T12
test('playing past the song’s last frame stops there and says it ended', () => {
  const t = playingAt(4 * RATE - RATE / 100)
  play(t, RATE / 10)
  assert.deepEqual([t.playing, t.ended, t.pos], [false, true, 4 * RATE - 1])
  assert.ok(last(play(t, RATE / 2)) < 1e-3, 'silent once stopped')
})

// Beat jump spec T6.
test('a search moves the playhead at its speed paused, on top of play playing, wraps at a loop’s out and ends at either edge', () => {
  const paused = playingAt(BEAT)
  paused.playing = false
  paused.search = 4
  play(paused, RATE / 2)
  assert.equal(speedOf(paused, 1.08), 4)
  assert.ok(Math.abs(paused.pos - (BEAT + 2 * RATE)) < 4 * 0.01 * RATE, 'four frames a frame, within the glide’s lag')
  const playing = playingAt(BEAT)
  playing.search = -4
  assert.equal(speedOf(playing, 1.08), 1.08 - 4)
  const loop = { in: BEAT, out: 2 * BEAT }
  const looped = playingAt(loop.in, loop)
  looped.search = 4
  assert.ok(within(positions(looped, RATE / 2), loop))
  const ending = playingAt(4 * RATE - RATE / 10)
  ending.search = 4
  play(ending, RATE / 10)
  assert.deepEqual([ending.playing, ending.ended, ending.pos, ending.search], [false, true, 4 * RATE - 1, 0])
  const starting = playingAt(RATE / 100)
  starting.playing = false
  starting.search = -4
  play(starting, RATE / 10)
  assert.deepEqual([starting.pos, starting.search], [0, 0])
})

// Remaining SHIFT spec T3.
test('reversed, the playhead reads backward at the rate, a held deck stays put, and the start stops playback and says it ended', () => {
  const t = playingAt(2 * BEAT)
  t.reverse = true
  assert.equal(speedOf(t, 1.08), -1.08)
  play(t, RATE / 2, 1.08)
  assert.ok(Math.abs(t.pos - (2 * BEAT - 1.08 * (RATE / 2))) < 1.08 * 0.01 * RATE + 1, 'within the glide’s lag')
  const held = playingAt(2 * BEAT)
  held.reverse = held.held = true
  play(held, RATE / 10)
  assert.equal(held.pos, 2 * BEAT)
  const starting = playingAt(RATE / 100)
  starting.reverse = true
  play(starting, RATE / 2)
  assert.deepEqual([starting.playing, starting.ended, starting.pos], [false, true, 0])
})

test('reversed, a loop wraps from its in to its out to the sample; forward, a nudge back across in still leaves it', () => {
  const loop = { in: BEAT, out: BEAT + BEAT / 64 }
  const t = playingAt(loop.in + 100, loop)
  t.reverse = true
  const frames = positions(t, RATE)
  assert.ok(within(frames, loop))
  assert.ok(frames.some((p, i) => i > 0 && p > frames[i - 1]), 'it wrapped up to out')
  const forward = playingAt(loop.in + 100, { in: BEAT, out: 2 * BEAT })
  forward.playing = false
  jog(forward, -1000)
  play(forward, RATE / 10)
  assert.ok(forward.pos < BEAT)
})
