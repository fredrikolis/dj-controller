// Concern: checks the beat jump spec's T1-T5, T7: the pads' sizes, whole beats either way, SHIFT's 16, none off the track, an active loop moved along | Non-concern: the controls | IO: none
import assert from 'node:assert/strict'
import test from 'node:test'
import type { Grid } from '../../shared/transport/grid.ts'
import { looping, NO_LOOP } from '../../shared/transport/loop-state.ts'
import { buttonBeats, jumped, padJump, searchFrames, type Jumping } from './jump.ts'

const BEAT = 20000
const grid: Grid = { first: 0, beat: BEAT, end: 32 * BEAT }
const idle: Jumping = { loaded: true, loop: NO_LOOP }

const seekOf = (position: number, beats: number, direction: -1 | 1, deck: Jumping = idle) => jumped(deck, position, beats, direction, grid).seek

test('T1: page 1 pads jump 1, 2, 4 and 8 beats and page 2 pads 16 to 128, left then right in pairs; no pad 8 or page 2', () => {
  const page = (p: number) => Array.from({ length: 8 }, (_, i) => padJump(p, i)).map(({ beats, direction }) => beats * direction)
  assert.deepEqual(page(0), [-1, 1, -2, 2, -4, 4, -8, 8])
  assert.deepEqual(page(1), [-16, 16, -32, 32, -64, 64, -128, 128])
  assert.throws(() => padJump(0, 8), RangeError)
  assert.throws(() => padJump(2, 0), RangeError)
})

test('T2: a press jumps 4 beats and SHIFT 16, either way, keeping the beat phase; no song, nothing', () => {
  const from = 20 * BEAT + 123
  assert.deepEqual([buttonBeats(false), buttonBeats(true)], [4, 16])
  assert.deepEqual([seekOf(from, 4, 1), seekOf(from, 4, -1)], [from + 4 * BEAT, from - 4 * BEAT])
  assert.deepEqual([seekOf(from, 16, 1), seekOf(from, 16, -1)], [null, from - 16 * BEAT])
  assert.equal(seekOf(from, 128, -1), null)
  assert.equal(seekOf(from, 1, 1, { ...idle, loaded: false }), null)
})

test('T3: a jump that would land before the start or at or past the end does not jump; one landing on either edge inside does', () => {
  assert.equal(seekOf(15 * BEAT, 16, -1), null)
  assert.equal(seekOf(16 * BEAT, 16, -1), 0)
  assert.equal(seekOf(16 * BEAT, 16, 1), null)
  assert.equal(seekOf(16 * BEAT - 1, 16, 1), 32 * BEAT - 1)
})

test('T4: an active loop moves with the playhead and stays active; none moved off the track', () => {
  const deck: Jumping = { loaded: true, loop: looping({ in: 5 * BEAT, out: 9 * BEAT }) }
  const step = jumped(deck, 7.5 * BEAT, 4, 1, grid)
  assert.equal(step.seek, 11.5 * BEAT)
  assert.deepEqual(step.deck.loop, looping({ in: 9 * BEAT, out: 13 * BEAT }))
  assert.equal(jumped(deck, 7.5 * BEAT, 8, -1, grid).seek, null)
  assert.equal(jumped({ ...deck, loop: looping({ in: 28 * BEAT, out: 31 * BEAT }) }, 29 * BEAT, 2, 1, grid).seek, null)
  assert.deepEqual(jumped({ ...deck, loop: looping({ in: 28 * BEAT, out: 30 * BEAT }) }, 29 * BEAT, 2, 1, grid).deck.loop.stored, { in: 30 * BEAT, out: 32 * BEAT })
})

test('T5: a stored inactive loop and a pending in stay put', () => {
  const stored: Jumping = { loaded: true, loop: { stored: { in: 0, out: 4 * BEAT }, active: false, pending: 12 * BEAT, adjust: null } }
  const step = jumped(stored, 2 * BEAT, 8, 1, grid)
  assert.equal(step.seek, 10 * BEAT)
  assert.equal(step.deck, stored)
})

test('T7: a revolution of the jog top with 4 BEAT JUMP held searches 32 beats, either way', () => {
  assert.deepEqual([searchFrames(1, grid), searchFrames(-0.5, grid)], [32 * BEAT, -16 * BEAT])
})
