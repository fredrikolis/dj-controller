// Concern: checks taps into a BPM: no BPM from one tap, the mean of the last 4 intervals, a 2 s gap starting again | Non-concern: what the BPM sets | IO: none
import assert from 'node:assert/strict'
import test from 'node:test'
import { tapped, tappedBpm, type Taps } from './tap.ts'

const bpm = (times: number[]): number | null => tappedBpm(times.reduce<Taps>(tapped, []))

test('one tap gives no BPM, two give theirs, and the last 4 intervals average', () => {
  assert.deepEqual([bpm([1000]), bpm([1000, 1500])], [null, 120])
  assert.equal(bpm([0, 1000, 1500, 2000, 2500, 3000]), 120)
  assert.equal(bpm([0, 400, 1000, 1600, 2200, 2800]), 100)
})

test('a tap over 2 s after the last starts again; one at 2 s does not', () => {
  assert.equal(bpm([0, 500, 2501]), null)
  assert.equal(bpm([0, 2000]), 30)
})
