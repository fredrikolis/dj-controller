// Concern: checks the sampler spec's T4 and T6: [-]/[+], BPM SYNC to the master deck, a loop's render BPM and rate, Q's start, GAIN and SAMPLER VOL as gains | Non-concern: Web Audio | IO: none
import assert from 'node:assert/strict'
import test from 'node:test'
import { bpmOf, BPM_RANGE, BPM_STEP, gainOf, loopOffset, rateOf, renderBpmOf, RENDER_RANGE, steppedBpm, volumeOf, type DeckClock } from './clock.ts'
import { SAMPLER_START } from './sampler-state.ts'

const deck = (playing: boolean, bpm: number, beat = 0): DeckClock => ({ playing, bpm, beat })

test('T4: [-]/[+] step the BPM within its range and do nothing under BPM SYNC', () => {
  assert.equal(steppedBpm(SAMPLER_START, 1).bpm, SAMPLER_START.bpm + BPM_STEP)
  assert.equal(steppedBpm(SAMPLER_START, -1).bpm, SAMPLER_START.bpm - BPM_STEP)
  assert.equal(steppedBpm({ ...SAMPLER_START, bpm: BPM_RANGE[1] }, 1).bpm, BPM_RANGE[1])
  assert.equal(steppedBpm({ ...SAMPLER_START, bpm: BPM_RANGE[0] }, -1).bpm, BPM_RANGE[0])
  const synced = { ...SAMPLER_START, sync: true }
  assert.equal(steppedBpm(synced, 1), synced)
})

test('T4: BPM SYNC takes the master deck\'s BPM, playing or not; without it the sampler keeps its own', () => {
  assert.equal(bpmOf({ bpm: 120, sync: false }, deck(true, 150)), 120)
  assert.equal(bpmOf({ bpm: 120, sync: true }, deck(true, 150)), 150)
  assert.equal(bpmOf({ bpm: 120, sync: true }, deck(false, 140)), 140)
})

test('T4: a loop renders at the BPM within the render range and reads at the BPM over its render\'s', () => {
  assert.equal(renderBpmOf(130), 130)
  assert.equal(renderBpmOf(20), RENDER_RANGE[0])
  assert.equal(renderBpmOf(400), RENDER_RANGE[1])
  assert.equal(rateOf(150, 144), 150 / 144)
  assert.equal(rateOf(0, 72), 0)
  assert.throws(() => rateOf(144, 0), RangeError)
})

test('T4: Q starts a loop as far into its beat as the master deck is past its own; without Q or with nothing playing, at its start', () => {
  const playing = deck(true, 144, 10.25)
  assert.equal(loopOffset({ quantize: true }, playing, 120), 0.25 * 0.5)
  assert.equal(loopOffset({ quantize: false }, playing, 120), 0)
  assert.equal(loopOffset({ quantize: true }, deck(false, 144, 10.25), 120), 0)
})

test('T6: GAIN in dB, SAMPLER VOL on the channel faders\' square law', () => {
  assert.equal(gainOf(0), 1)
  assert.ok(Math.abs(gainOf(-6) - 0.501) < 0.001)
  assert.equal(volumeOf(0.5), 0.25)
  assert.equal(volumeOf(1), 1)
})
