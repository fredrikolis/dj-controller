// Concern: checks the master limiter: no frame over the ceiling, frames under it passed bit for bit after the look-ahead, the gain back after a peak | Non-concern: the worklet | IO: none
import assert from 'node:assert/strict'
import test from 'node:test'
import { CEILING, createLimiter } from './limiter.ts'

const RATE = 48000

/** A seeded generator, so a failure replays. */
function noise(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32
    return s / 2 ** 31 - 1
  }
}

/** `input` through a new limiter in blocks of 128, as the audio thread gives them. */
function limited(input: readonly Float32Array[]): Float32Array[] {
  const limiter = createLimiter(RATE, input.length)
  const out = input.map((c) => Float32Array.from(c))
  for (let at = 0; at < (out[0]?.length ?? 0); at += 128) limiter.process(out.map((c) => c.subarray(at, at + 128)))
  return out
}

const peakOf = (channels: readonly Float32Array[]): number => Math.max(...channels.map((c) => c.reduce((p, x) => Math.max(p, Math.abs(x)), 0)))

test('two loud loops and a deck summed, up to 4x full scale, never leave a frame over the ceiling', () => {
  const next = noise(7)
  const frames = RATE * 2
  const sum = (k: number) => Float32Array.from({ length: frames }, (_, i) => 0.9 * Math.sin((2 * Math.PI * 55 * i) / RATE) + 0.9 * Math.sin((2 * Math.PI * (330 + k) * i) / RATE) + (i % 24000 < 200 ? 2 * next() : 0.3 * next()))
  for (const k of [0, 3, 11]) {
    const out = limited([sum(k), sum(k + 5)])
    assert.ok(peakOf(out) <= CEILING + 1e-6, `peak ${peakOf(out)} over ${CEILING}`)
  }
})

test('a deck under the ceiling passes untouched, delayed by the look-ahead', () => {
  const frames = RATE
  const deck = Float32Array.from({ length: frames }, (_, i) => 0.85 * Math.sin((2 * Math.PI * 440 * i) / RATE))
  const delay = createLimiter(RATE, 1).delay
  const [out] = limited([deck])
  assert.ok(out)
  for (let i = delay; i < frames; i++) assert.equal(out[i], deck[i - delay], `frame ${i}`)
})

test('a single peak is limited, and the gain is back to 1 within a second after it', () => {
  const frames = RATE * 2
  const input = Float32Array.from({ length: frames }, (_, i) => (i === 1000 ? 4 : 0.5))
  const [out] = limited([input])
  assert.ok(out)
  const delay = createLimiter(RATE, 1).delay
  assert.ok(Math.abs(out[1000 + delay] ?? 0) <= CEILING + 1e-6)
  assert.ok((out[1000 + delay - 1] ?? 1) < 0.5, 'the gain glides down before the peak')
  assert.ok(Math.abs((out[RATE + 1000 + delay] ?? 0) - 0.5) < 1e-3, 'released within a second')
})
