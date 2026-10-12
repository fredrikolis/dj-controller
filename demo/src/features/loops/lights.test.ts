// Concern: checks the loops spec's T13: loop state as lights, IN and OUT lit, blinking in a loop, fast while adjusted, EXIT, RELOOP | Non-concern: writing them (show-lights.test.ts) | IO: none
import assert from 'node:assert/strict'
import test from 'node:test'
import type { Grid } from '../../shared/transport/grid.ts'
import { NO_LOOP } from '../../shared/transport/loop-state.ts'
import { lightsOf } from './lights.ts'
import { press4BeatExit, type Looping } from './loop.ts'

const grid: Grid = { first: 0, beat: 20000, end: 32 * 20000 }
const idle: Looping = { loaded: true, playing: true, cue: 0, quantize: true, loop: NO_LOOP }
const looping = press4BeatExit(idle, 20000, grid).deck
const stored = press4BeatExit(looping, 30000, grid).deck

test('idle with a song: IN, OUT and QUANTIZE lit, EXIT and RELOOP dark', () => {
  assert.deepEqual(lightsOf(idle, grid), { quantize: true, loopIn: 'on', loopOut: 'on', exit: false, reloop: false, beats: null })
})

test('a loop blinks IN and OUT and lights EXIT, RELOOP dark, its pad’s length blinking; stored and inactive lights RELOOP', () => {
  assert.deepEqual(lightsOf(looping, grid), { quantize: true, loopIn: 'blink', loopOut: 'blink', exit: true, reloop: false, beats: 4 })
  assert.deepEqual(lightsOf(stored, grid), { quantize: true, loopIn: 'on', loopOut: 'on', exit: false, reloop: true, beats: null })
  assert.equal(lightsOf({ ...looping, loop: { ...looping.loop, adjust: 'out' } }, grid).loopOut, 'fast')
})
