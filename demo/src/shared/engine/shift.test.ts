// Concern: checks the key shift spec's T6: a shifted render's rate whole, its bars their frames, an SVA tone sounding k semitones away | Non-concern: the player | IO: (sva-wasm) -> assertions
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { BEATS_PER_BAR, loopFrames } from '../beat-grid/beat-grid.ts'
import { MAX_SEMITONES, shiftedRender } from './shift.ts'

const RATE = 48000
const wasm = createRequire(import.meta.url).resolve('@scalable-vector-audio/sva-wasm/sva_wasm_bg.wasm')

type Rendering = { samples(channel: number): Float32Array; free(): void }
type Composition = { insert(path: string, text: string): void; render(target: string, representations: null, options: { rate: number }): Promise<Rendering> }
type SvaWasm = { initSync(input: { module: Uint8Array }): unknown; Composition: new (name: string) => Composition }

// As sounds.test.ts: sva-wasm reads `self` at import.
Object.assign(globalThis, { self: new EventTarget() })
const SVA_WASM: string = '@scalable-vector-audio/sva-wasm'
const { initSync, Composition }: SvaWasm = await import(SVA_WASM)
initSync({ module: readFileSync(wasm) })

const SHIFTS = Array.from({ length: 2 * MAX_SEMITONES + 1 }, (_, i) => i - MAX_SEMITONES)

test('T6: every shift renders at a whole rate, a bar keeping its frames at the BPM asked, the pitch within 0.1 cent', () => {
  for (const rate of [44100, 48000]) {
    for (const k of SHIFTS) {
      const shifted = shiftedRender(144, k, rate)
      assert.ok(Number.isInteger(shifted.rate))
      assert.ok(Math.abs(loopFrames(1, shifted.bpm, shifted.rate) - loopFrames(1, 144, rate)) <= 1, `${k} at ${rate}`)
      assert.ok(Math.abs(1200 * Math.log2(rate / shifted.rate) - 100 * k) < 0.1, `${k} at ${rate}`)
    }
  }
})

/** Upward zero crossings, each placed between its frames, over the time from the first to the last. */
function frequencyOf(samples: Float32Array): number {
  const crossings: number[] = []
  for (let i = 1; i < samples.length; i++) {
    const [a, b] = [samples[i - 1] ?? 0, samples[i] ?? 0]
    if (a < 0 && b >= 0) crossings.push(i - 1 + a / (a - b))
  }
  return ((crossings.length - 1) * RATE) / ((crossings.at(-1) ?? 0) - (crossings[0] ?? 0))
}

test('T6: a tone of a bar, rendered shifted and played at the context rate, sounds k semitones away with the frames of the unshifted bar', async () => {
  const composition = new Composition('dj-controller-demo-shift-test')
  composition.insert('variables/meter', `${BEATS_PER_BAR}/4`)
  composition.insert('tone', 'crop(sin(2*pi*440*t), 0s, 1b)')
  for (const k of [-5, 0, 7]) {
    const { bpm, rate } = shiftedRender(120, k, RATE)
    composition.insert('variables/bpm', String(bpm))
    const rendering = await composition.render('@tone', null, { rate })
    const samples = new Float32Array(rendering.samples(0))
    rendering.free()
    assert.ok(Math.abs(samples.length - loopFrames(1, 120, RATE)) <= 1, `${k}: ${samples.length} frames`)
    const expected = 440 * 2 ** (k / 12)
    assert.ok(Math.abs(frequencyOf(samples) / expected - 1) < 0.001, `${k}: ${frequencyOf(samples)} Hz, not ${expected}`)
  }
})
