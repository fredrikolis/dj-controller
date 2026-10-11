// Concern: checks the loop rules at the loops spec's T1-T8, T11, T12: snaps, out before in, auto loops, halve and double limits, RELOOP, pads, seeks, the end | Non-concern: the wrap | IO: none
import assert from 'node:assert/strict'
import test from 'node:test'
import type { Grid } from '../../shared/transport/grid.ts'
import { NO_LOOP, sought, type LoopPoints } from '../../shared/transport/loop-state.ts'
import { adjustBy, beatsOf, PAD_BEATS, press4BeatExit, pressAdjustIn, pressBeatLoop, pressLoopIn, pressLoopOut, pressQuantize, pressReloop, type Looping } from './loop.ts'

// 144 BPM at 48 kHz: a beat is 20000 frames. The demo's songs are 32 beats; `long` fits 512.
const grid: Grid = { first: 0, beat: 20000, end: 32 * 20000 }
const long: Grid = { first: 0, beat: 20000, end: 1024 * 20000 }
const deck: Looping = { loaded: true, playing: true, cue: 0, quantize: false, loop: NO_LOOP }
const quantized: Looping = { ...deck, quantize: true }

const points = (d: Looping): LoopPoints | null => d.loop.stored

// T1
test('without quantize IN and OUT loop where pressed; with it IN snaps to the nearest beat and sets the cue there', () => {
  const pending = pressLoopIn(deck, 12345, grid).deck
  const set = pressLoopOut(pending, 47000, grid).deck
  assert.deepEqual([points(set), set.loop.active], [{ in: 12345, out: 47000 }, true])
  const snapped = pressLoopIn(quantized, 12345, grid).deck
  assert.deepEqual([snapped.loop.pending, snapped.cue], [20000, 20000])
  assert.equal(pressLoopIn(quantized, 9999, grid).deck.loop.pending, 0)
})

// T2: the playhead's fold is the player's (playhead.test.ts).
test('with quantize an out snapped onto in makes a 1-beat loop', () => {
  const pending = pressLoopIn(quantized, 20000, grid).deck
  assert.deepEqual(points(pressLoopOut(pending, 25000, grid).deck), { in: 20000, out: 40000 })
  assert.deepEqual(points(pressLoopOut(pending, 50000, grid).deck), { in: 20000, out: 60000 }, 'snapped behind the playhead, folded in by the player')
})

// T3
test('OUT with no IN loops from a cue point behind the playhead, and is ignored with the cue ahead', () => {
  assert.deepEqual(points(pressLoopOut({ ...quantized, cue: 20000 }, 50000, grid).deck), { in: 20000, out: 60000 })
  const ahead = { ...quantized, cue: 50000 }
  assert.equal(pressLoopOut(ahead, 50000, grid).deck, ahead)
})

// T4
test('4 BEAT loops four beats from the press, or from its nearest beat with quantize, and again exits it, kept', () => {
  assert.deepEqual(points(press4BeatExit(deck, 30000, grid).deck), { in: 30000, out: 110000 })
  const looping = press4BeatExit(quantized, 30000, grid).deck
  assert.deepEqual(points(looping), { in: 40000, out: 120000 })
  const exited = press4BeatExit(looping, 50000, grid).deck
  assert.deepEqual([points(exited), exited.loop.active], [{ in: 40000, out: 120000 }, false])
})

// T5
test('halving a 4-beat loop reaches 1/64 beat in 8 presses and no shorter; doubling stops at 512 beats or the song’s end', () => {
  let looping = press4BeatExit(deck, 0, grid).deck
  for (let i = 0; i < 8; i++) looping = pressLoopIn(looping, 100, grid).deck
  assert.deepEqual(points(looping), { in: 0, out: 312.5 })
  assert.equal(pressLoopIn(looping, 100, grid).deck, looping)
  let doubled = press4BeatExit(deck, 0, long).deck
  for (let i = 0; i < 10; i++) doubled = pressLoopOut(doubled, 100, long).deck
  assert.equal(beatsOf(points(doubled) ?? { in: 0, out: 0 }, long), 512)
  let song = press4BeatExit(deck, 0, grid).deck
  for (let i = 0; i < 5; i++) song = pressLoopOut(song, 100, grid).deck
  assert.equal(beatsOf(points(song) ?? { in: 0, out: 0 }, grid), 32, 'a double past the song’s end is ignored')
})

// T6: the playhead's fold after a halve is the player's (playhead.test.ts).
test('halving while paused at in changes nothing', () => {
  const paused = { ...press4BeatExit(deck, 20000, grid).deck, playing: false }
  assert.equal(pressLoopIn(paused, 20000, grid).deck, paused)
  assert.deepEqual(points(pressLoopIn(paused, 90000, grid).deck), { in: 20000, out: 60000 }, 'paused elsewhere it halves')
})

// T7
test('RELOOP after an exit returns to in, looping, play unchanged; with nothing stored it does nothing', () => {
  const exited = press4BeatExit(press4BeatExit(deck, 20000, grid).deck, 50000, grid).deck
  const { deck: back, seek } = pressReloop({ ...exited, playing: false }, 130000, grid)
  assert.deepEqual([seek, back.loop.active, back.playing], [20000, true, false])
  assert.equal(pressReloop(deck, 130000, grid).deck, deck)
  assert.equal(pressReloop({ ...exited, quantize: true }, 125000, grid).seek, 25000, 'with quantize, in plus the beat phase')
})

// T8
test('beat-loop pads: page 1 pad 7 loops a beat, again exits; pad 8 then keeps in at 2 beats; page 2 pad 8 loops 512', () => {
  const beat = pressBeatLoop(deck, PAD_BEATS[0]?.[6] ?? 0, 30000, grid).deck
  assert.deepEqual(points(beat), { in: 30000, out: 50000 })
  assert.equal(pressBeatLoop(beat, PAD_BEATS[0]?.[6] ?? 0, 40000, grid).deck.loop.active, false)
  assert.deepEqual(points(pressBeatLoop(beat, PAD_BEATS[0]?.[7] ?? 0, 40000, grid).deck), { in: 30000, out: 70000 })
  assert.equal(beatsOf(points(pressBeatLoop(deck, PAD_BEATS[1]?.[7] ?? 0, 0, long).deck) ?? { in: 0, out: 0 }, long), 512)
})

// T11
test('a seek outside the loop exits it, kept; one inside keeps it looping', () => {
  const looping = press4BeatExit(deck, 20000, grid).deck.loop
  assert.deepEqual(sought(looping, 0), { ...looping, active: false })
  assert.equal(sought(looping, 30000), looping)
})

// T12
test('a loop whose out would pass the song’s end ends there', () => {
  assert.deepEqual(points(press4BeatExit(deck, grid.end - 20000, grid).deck), { in: grid.end - 20000, out: grid.end })
  assert.deepEqual(points(pressBeatLoop(deck, 512, 0, grid).deck), { in: 0, out: grid.end })
})

test('quantize toggles per press; SHIFT+LOOP IN and OUT adjust a point by jog frames, unsnapped, never under 1/64 beat; a loop button ends the adjust', () => {
  assert.equal(pressQuantize(quantized).deck.quantize, false)
  const looping = press4BeatExit(quantized, 20000, grid).deck
  const adjusting = pressAdjustIn(looping).deck
  assert.deepEqual(points(adjustBy(adjusting, 1234, grid)), { in: 21234, out: 100000 })
  assert.deepEqual(points(adjustBy(adjusting, 90000, grid)), { in: 100000 - 312.5, out: 100000 })
  const out = pressReloop(looping, 0, grid).deck
  assert.deepEqual([out.loop.adjust, points(adjustBy(out, -1000, grid))], ['out', { in: 20000, out: 99000 }])
  const ended = pressLoopIn(adjusting, 30000, grid).deck
  assert.deepEqual([ended.loop.adjust, points(ended)], [null, points(looping)])
  assert.equal(pressAdjustIn(deck).deck, deck, 'with no loop it does nothing')
})
