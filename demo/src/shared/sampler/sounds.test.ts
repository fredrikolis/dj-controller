// Concern: checks the sampler spec's T7: every slot's node renders with the demo's sva-wasm, sounding and unclipped, a loop folding to its bars | Non-concern: how it sounds | IO: (samples) -> assertions
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { BEATS_PER_BAR, loopFrames } from '../beat-grid/beat-grid.ts'
import { SLOTS } from './banks.ts'

const RATE = 48000
const SAMPLES = new URL('../../../samples/', import.meta.url)
const wasm = createRequire(import.meta.url).resolve('@scalable-vector-audio/sva-wasm/sva_wasm_bg.wasm')

type Rendering = { samples(channel: number): Float32Array; free(): void }
type Composition = { insert(path: string, text: string): void; render(target: string, representations: null, options: { rate: number }): Promise<Rendering> }
type SvaWasm = { initSync(input: { module: Uint8Array }): unknown; Composition: new (name: string) => Composition }

// sva-wasm's thread helper reads `self` at import, a worker's global Node lacks; its types name browser globals this test's lib leaves out.
Object.assign(globalThis, { self: new EventTarget() })
const SVA_WASM: string = '@scalable-vector-audio/sva-wasm'
const { initSync, Composition }: SvaWasm = await import(SVA_WASM)
initSync({ module: readFileSync(wasm) })

const composition = new Composition('dj-controller-demo-test')
for (const file of readdirSync(SAMPLES)) composition.insert(file.replace(/\.sva$/, ''), readFileSync(new URL(file, SAMPLES), 'utf8'))
composition.insert('variables/meter', `${BEATS_PER_BAR}/4`)

async function render(node: string, bpm: number): Promise<Float32Array> {
  composition.insert('variables/bpm', String(bpm))
  const rendering = await composition.render(`@${node}`, null, { rate: RATE })
  try {
    return new Float32Array(rendering.samples(0))
  } finally {
    rendering.free()
  }
}

const peakOf = (samples: Float32Array): number => samples.reduce((peak, x) => Math.max(peak, Math.abs(x)), 0)

test('T7: every slot renders, louder than -30 dBFS at its peak and under full scale', async () => {
  for (const slot of SLOTS) {
    const peak = peakOf(await render(slot.node, 144))
    assert.ok(peak > 10 ** (-30 / 20) && peak < 1, `${slot.name} (${slot.node}.sva) peaks at ${peak}`)
  }
})

test('T7: a loop rings within its bars plus a tail, at 144 and at 120 BPM, so it folds to its bars', async () => {
  for (const slot of SLOTS.filter((s) => s.bars !== null)) {
    for (const bpm of [144, 120]) {
      const frames = loopFrames(slot.bars ?? 0, bpm, RATE)
      const length = (await render(slot.node, bpm)).length
      assert.ok(length > frames * 0.75 && length < frames + 4 * RATE, `${slot.name} at ${bpm} BPM: ${length} frames for ${frames}`)
    }
  }
})
