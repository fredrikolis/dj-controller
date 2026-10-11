// Concern: checks the hot cue rules at the hot cues spec's T1-T9: snaps, hot loops, no overwrite, clears, calls, loops, previews, slots, reloads, ?cues= | Non-concern: lights | IO: none
import assert from 'node:assert/strict'
import test from 'node:test'
import { cuesOf, withCues } from '../view.ts'
import { loadedState, type DeckState } from '../transport/deck-state.ts'
import type { Grid } from '../transport/grid.ts'
import { NO_HOT_CUES, slotName, type HotCue } from '../transport/hot-cue-state.ts'
import { looping, NO_LOOP } from '../transport/loop-state.ts'
import { NO_MEMORY_CUES } from '../transport/memory-cue-state.ts'
import { calledSlot, pressPad, pressShiftPad, slotOf, type Cueing } from './hot-cue.ts'

// 144 BPM at 48 kHz: a beat is 20000 frames; the demo's songs are 32 beats.
const grid: Grid = { first: 0, beat: 20000, end: 32 * 20000 }
const paused: Cueing = { loaded: true, playing: false, previewing: false, cue: 0, quantize: false, loop: NO_LOOP, hotCues: NO_HOT_CUES }
const playing: Cueing = { ...paused, playing: true }
const A = 0
const B = 1

const withCue = (deck: Cueing, slot: number, cue: HotCue): Cueing => ({ ...deck, hotCues: deck.hotCues.map((c, i) => (i === slot ? cue : c)) })
const setAt = (deck: Cueing, position: number): HotCue | null => pressPad(deck, A, position, grid).deck.hotCues[A] ?? null

test('T1: without quantize a set stores the press position; with it the nearest beat, a tie going up', () => {
  assert.deepEqual(setAt(playing, 12345), { kind: 'cue', at: 12345 })
  const quantized = { ...playing, quantize: true }
  assert.deepEqual([12345, 9999, 30000].map((p) => setAt(quantized, p)), [20000, 0, 40000].map((at) => ({ kind: 'cue', at })))
  assert.deepEqual(setAt({ ...paused, quantize: true }, 12345), { kind: 'cue', at: 20000 }, 'paused too')
})

test('T2: during an active loop a set stores it as a hot loop; with only a pending in, a cue; setting moves nothing', () => {
  const looped = { ...playing, loop: looping({ in: 20000, out: 100000 }) }
  const { deck, seek } = pressPad(looped, A, 50000, grid)
  assert.deepEqual([deck.hotCues[A], seek], [{ kind: 'loop', in: 20000, out: 100000 }, null])
  assert.deepEqual({ ...deck, hotCues: looped.hotCues }, looped, 'play, CUE point and loop unchanged')
  assert.deepEqual(setAt({ ...playing, loop: { ...NO_LOOP, pending: 20000 } }, 50000), { kind: 'cue', at: 50000 })
  assert.equal(pressPad({ ...playing, loaded: false }, A, 50000, grid).deck.hotCues[A], null, 'no song, no cue')
})

test('T3: a press on a set slot never changes it; SHIFT+press empties it; SHIFT on an empty slot changes nothing', () => {
  const set = withCue(paused, A, { kind: 'cue', at: 40000 })
  assert.deepEqual(pressPad(set, A, 90000, grid).deck.hotCues[A], { kind: 'cue', at: 40000 })
  const cleared = pressShiftPad(set, A)
  assert.deepEqual([cleared.deck.hotCues[A], cleared.seek, cleared.deck.playing], [null, null, false])
  assert.equal(pressShiftPad(set, B).deck, set)
})

test('T4: a cue called while paused at 5000 jumps to 40000 and plays, quantize or not', () => {
  for (const quantize of [false, true]) {
    const { deck, seek } = pressPad(withCue({ ...paused, quantize }, A, { kind: 'cue', at: 40000 }), A, 5000, grid)
    assert.deepEqual([seek, deck.playing], [40000, true])
  }
})

test('T5: a cue called while playing at 47000 lands at 87000 with quantize, keeping the beat, and at 80000 without', () => {
  const cued = withCue(playing, A, { kind: 'cue', at: 80000 })
  assert.equal(pressPad({ ...cued, quantize: true }, A, 47000, grid).seek, 87000)
  assert.equal(pressPad(cued, A, 47000, grid).seek, 80000)
})

test('T6: a hot loop called loops [20000, 100000) from in and plays; with quantize from 47000 at 27000; a re-press restarts from in', () => {
  const hot = withCue(paused, A, { kind: 'loop', in: 20000, out: 100000 })
  const called = pressPad(hot, A, 5000, grid)
  assert.deepEqual([called.seek, called.deck.loop, called.deck.playing], [20000, looping({ in: 20000, out: 100000 }), true])
  assert.equal(pressPad({ ...hot, playing: true, quantize: true }, A, 47000, grid).seek, 27000)
  const again = pressPad({ ...called.deck, playing: true }, A, 60000, grid)
  assert.deepEqual([again.seek, again.deck.loop.active], [20000, true])
  assert.equal(calledSlot(called.deck), A)
})

test('T6: halving a called hot loop leaves its slot at its first length; clearing the slot keeps the loop looping', () => {
  const called = pressPad(withCue(playing, A, { kind: 'loop', in: 20000, out: 100000 }), A, 0, grid).deck
  const halved = { ...called, loop: looping({ in: 20000, out: 60000 }) }
  assert.deepEqual([halved.hotCues[A], calledSlot(halved)], [{ kind: 'loop', in: 20000, out: 100000 }, null])
  assert.deepEqual(pressShiftPad(called, A).deck.loop, called.loop)
})

test('T7: a cue jump outside an active loop exits it, kept; one inside keeps it looping', () => {
  const looped = { ...playing, loop: looping({ in: 20000, out: 100000 }) }
  const outside = pressPad(withCue(looped, B, { kind: 'cue', at: 120000 }), B, 30000, grid).deck.loop
  assert.deepEqual([outside.stored, outside.active], [{ in: 20000, out: 100000 }, false])
  assert.equal(pressPad(withCue(looped, B, { kind: 'cue', at: 40000 }), B, 30000, grid).deck.loop.active, true)
})

test('T8: a call while CUE previews ends the preview, playing on; no call moves the CUE point', () => {
  const previewing: Cueing = { ...withCue(playing, A, { kind: 'cue', at: 80000 }), previewing: true, cue: 20000 }
  const { deck } = pressPad(previewing, A, 20000, grid)
  assert.deepEqual([deck.previewing, deck.playing, deck.cue], [false, true, 20000])
  const hot = withCue({ ...paused, cue: 20000 }, B, { kind: 'loop', in: 40000, out: 60000 })
  assert.equal(pressPad(hot, B, 0, grid).deck.cue, 20000)
})

test('T9: page 2 pad 8 (9p 0F) is slot P', () => {
  assert.equal(slotOf(1, 7), 15)
  assert.equal(slotName(slotOf(1, 7)), 'P')
})

test('T9: hot cues survive a reload of the song, and a ?cues= round trip', () => {
  const cues = withCue(withCue(paused, A, { kind: 'cue', at: 12345.5 }), 15, { kind: 'loop', in: 20000, out: 100000 }).hotCues
  const deck: DeckState = { ...paused, reverse: false, touched: false, vinyl: true, tempo: 0.5, tempoRange: 0.1, masterTempo: true, keyShift: 0, keySync: false, locked: { bpm: 144, semitones: 0 }, loaded: false, loop: looping({ in: 0, out: 20000 }), hotCues: cues, memoryCues: NO_MEMORY_CUES }
  const reloaded = loadedState(deck)
  assert.deepEqual([reloaded.hotCues, reloaded.loop.active], [cues, false])
  const search = withCues('?state=playing', [cues, NO_HOT_CUES]) ?? ''
  assert.deepEqual(cuesOf(new URLSearchParams(search)), [cues, NO_HOT_CUES])
  assert.equal(withCues(search, [cues, NO_HOT_CUES]), null, 'unchanged, not rewritten')
  assert.equal(cuesOf(new URLSearchParams('cues=1Q5,x')), null, 'a malformed query is ignored')
})
