// Concern: checks the mix's fixed points: TRIM's and EQ's centres and ends, the crossfader's ends isolating each side at equal power, thru untouched | Non-concern: the curves' tuning | IO: none
import assert from 'node:assert/strict'
import test from 'node:test'
import { crossfaderGain, eqDb, trimGain } from './curves.ts'

test('EQ is neutral at its centre and runs from -26 dB to +6 dB (MAN p.176)', () => {
  assert.deepEqual([eqDb(0), eqDb(0.5), eqDb(1)], [-26, 0, 6])
})

test('TRIM is silent at its bottom, unity at its centre, and only rises between', () => {
  assert.deepEqual([trimGain(0), trimGain(0.5)], [0, 1])
  assert.ok(trimGain(1) > 1)
  for (let p = 0.01; p <= 1; p += 0.01) assert.ok(trimGain(p) > trimGain(p - 0.01))
})

test('each end of the crossfader silences the other side, the middle keeps equal power, and thru ignores it', () => {
  assert.deepEqual([crossfaderGain(0, 'a'), crossfaderGain(0, 'b')], [1, 0])
  assert.ok(crossfaderGain(1, 'a') < 1e-12 && crossfaderGain(1, 'b') === 1)
  assert.ok(Math.abs(crossfaderGain(0.5, 'a') ** 2 + crossfaderGain(0.5, 'b') ** 2 - 1) < 1e-12)
  assert.equal(crossfaderGain(0.3, 'thru'), 1)
})
