// Concern: checks the Beat FX spec's T8 lights: ON/OFF blinking while on and dark off, its SHIFT layer lit while the Release FX is held | Non-concern: the driver's writes | IO: none
import assert from 'node:assert/strict'
import test from 'node:test'
import type { Output } from '../../shared/lights/show-lights.ts'
import { ON_BLINK, planOf } from './lights.ts'
import { releaseHeld, START, toggled } from './unit-state.ts'

const out = (): Output<boolean> => ({ base: undefined, set: async () => {}, play: async () => {} })
const lights = { onOff: out(), release: out() }

test('T8: off, ON/OFF is dark and nothing blinks; on, it blinks', () => {
  assert.deepEqual(planOf(lights, START), { steady: [{ kind: 'led', out: lights.onOff, value: false }, { kind: 'led', out: lights.release, value: false }], blinks: [] })
  const on = planOf(lights, toggled(START))
  assert.deepEqual(on.blinks, [{ kind: 'led', name: 'beat-fx-on', out: lights.onOff, pattern: ON_BLINK }])
  assert.ok(!on.steady.some((s) => s.out === lights.onOff))
})

test('T8: the SHIFT layer lights while the Release FX is held, which turns the unit off', () => {
  const held = planOf(lights, releaseHeld(toggled(START), true))
  assert.deepEqual(held.steady, [{ kind: 'led', out: lights.onOff, value: false }, { kind: 'led', out: lights.release, value: true }])
  assert.deepEqual(held.blinks, [])
})
