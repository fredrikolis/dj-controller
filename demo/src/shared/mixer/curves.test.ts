// Concern: checks the mix's fixed points: EQ neutral at its centre, the crossfader's ends isolating each side at equal power, thru untouched | Non-concern: the curves' tuning | IO: none
import assert from 'node:assert/strict'
import test from 'node:test'
import { crossfaderGain, eqDb } from './curves.ts'

test('EQ is neutral at its centre', () => {
  assert.equal(eqDb(0.5), 0)
})

test('each end of the crossfader silences the other side, the middle keeps equal power, and thru ignores it', () => {
  assert.deepEqual([crossfaderGain(0, 'a'), crossfaderGain(0, 'b')], [1, 0])
  assert.ok(crossfaderGain(1, 'a') < 1e-12 && crossfaderGain(1, 'b') === 1)
  assert.ok(Math.abs(crossfaderGain(0.5, 'a') ** 2 + crossfaderGain(0.5, 'b') ** 2 - 1) < 1e-12)
  assert.equal(crossfaderGain(0.3, 'thru'), 1)
})
