// Concern: checks the memory cues spec's T1-T7: MEMORY, CALL ◀/▶, DELETE, Active Loop and its LED, one reached, hot cues apart, a load keeping them | Non-concern: the buttons | IO: none
import assert from 'node:assert/strict'
import test from 'node:test'
import { loadedState, type DeckState } from '../transport/deck-state.ts'
import type { Grid } from '../transport/grid.ts'
import { NO_HOT_CUES } from '../transport/hot-cue-state.ts'
import { looping, NO_LOOP, type Loop } from '../transport/loop-state.ts'
import { MAX_MEMORY_CUES, NO_MEMORY_CUES, type MemoryCue } from '../transport/memory-cue-state.ts'
import { pressPad, pressShiftPad } from '../hot-cues/hot-cue.ts'
import { activeLoopLit, calledOf, engaged, MemoryCuesFull, pressActiveLoop, pressCall, pressDelete, pressMemory, reached, type Remembering } from './memory-cue.ts'

// 144 BPM at 48 kHz: a beat is 20000 frames; the demo's songs are 32 beats.
const grid: Grid = { first: 0, beat: 20000, end: 32 * 20000 }
const paused: Remembering = { loaded: true, playing: false, previewing: false, cue: 0, loop: NO_LOOP, memoryCues: NO_MEMORY_CUES }
const playing: Remembering = { ...paused, playing: true }
const cue = (at: number): MemoryCue => ({ kind: 'cue', at })
const loop = (from: number, to: number, active = false): MemoryCue => ({ kind: 'loop', active, in: from, out: to })
const stored = (from: number, to: number): Loop => ({ stored: { in: from, out: to }, active: false, pending: null, adjust: null })
const saved = (deck: Remembering, ...points: MemoryCue[]): Remembering => ({ ...deck, memoryCues: points })
const SAVED = [cue(40000), loop(100000, 180000), cue(300000)]
const MOST = 1e9

test('T1: MEMORY saves the cue point, during loop play the loop not active, in song order, once; the 11th refused; unloaded nothing', () => {
  assert.deepEqual(pressMemory({ ...playing, cue: 40000 }).deck.memoryCues, [cue(40000)], 'the cue point, not the playhead')
  const looped = { ...saved(playing, cue(300000)), cue: 100000, loop: looping({ in: 100000, out: 180000 }) }
  assert.deepEqual(pressMemory(looped).deck.memoryCues, [loop(100000, 180000), cue(300000)])
  assert.deepEqual(pressMemory({ ...saved(paused, cue(300000)), cue: 40000, loop: stored(100000, 180000) }).deck.memoryCues, [cue(40000), cue(300000)], 'a stored loop is no loop play')
  const once = saved({ ...paused, cue: 40000 }, cue(40000))
  assert.equal(pressMemory(once).deck, once)
  const full = saved({ ...paused, cue: 1 }, ...Array.from({ length: MAX_MEMORY_CUES }, (_, i) => cue(1000 * (i + 2))))
  assert.throws(() => pressMemory(full), MemoryCuesFull)
  assert.equal(pressMemory({ ...paused, loaded: false }).deck.memoryCues, NO_MEMORY_CUES)
})

test('T2: CALL ◀ the nearest before, ▶ the nearest after; a cue jumps, sets the cue point and pauses; a loop is stored at its in', () => {
  const deck = { ...saved(playing, ...SAVED), previewing: true }
  const next = pressCall(deck, 1, 50000)
  assert.equal(next.seek, 100000)
  assert.deepEqual([next.deck.cue, next.deck.playing, next.deck.previewing, next.deck.loop], [100000, false, false, stored(100000, 180000)])
  const back = pressCall(deck, -1, 50000)
  assert.deepEqual([back.seek, back.deck.cue, back.deck.playing, back.deck.loop], [40000, 40000, false, NO_LOOP])
  assert.equal(pressCall(deck, 1, 100000).seek, 300000, 'one at the playhead skipped')
  assert.equal(pressCall(deck, -1, 100000).seek, 40000)
  assert.equal(pressCall(deck, 1, 300000).deck, deck, 'none after')
  assert.equal(pressCall(deck, -1, 40000).seek, null, 'none before')
  const out = pressCall({ ...deck, loop: looping({ in: 400000, out: 480000 }) }, -1, 450000)
  assert.deepEqual(out.deck.loop, { ...looping({ in: 400000, out: 480000 }), active: false }, 'a jump out of an active loop exits it, kept')
})

test('T3: DELETE removes the called loop, else the memory cue at the cue point; no jump; none called nothing', () => {
  const called = { ...saved(paused, ...SAVED), cue: 100000, loop: stored(100000, 180000) }
  const gone = pressDelete(called)
  assert.deepEqual([gone.deck.memoryCues, gone.seek, gone.deck.cue, gone.deck.loop], [[cue(40000), cue(300000)], null, 100000, stored(100000, 180000)])
  assert.deepEqual(pressDelete({ ...saved(paused, ...SAVED), cue: 300000 }).deck.memoryCues, SAVED.slice(0, 2))
  const none = { ...saved(paused, ...SAVED), cue: 5 }
  assert.equal(calledOf(none), null)
  assert.equal(pressDelete(none).deck, none)
})

test('T4: Active Loop switches the called loop, else the nearest; nothing without one; loop play unchanged; the LED', () => {
  const near = saved(playing, loop(100000, 180000), loop(300000, 380000))
  assert.deepEqual(pressActiveLoop(near, 250000).deck.memoryCues, [loop(100000, 180000), loop(300000, 380000, true)])
  assert.deepEqual(pressActiveLoop(near, 240000).deck.memoryCues, [loop(100000, 180000, true), loop(300000, 380000)], 'a tie, the earlier')
  assert.deepEqual(pressActiveLoop(near, 350000).deck.memoryCues[1], loop(300000, 380000, true), 'inside is nearest')
  const called = { ...near, loop: stored(100000, 180000) }
  const on = pressActiveLoop(called, 350000)
  assert.deepEqual([on.deck.memoryCues[0], on.deck.loop, on.seek], [loop(100000, 180000, true), stored(100000, 180000), null])
  assert.deepEqual(pressActiveLoop(pressActiveLoop(called, 0).deck, 0).deck.memoryCues[0], called.memoryCues[0], 'switched back')
  const cues = saved(playing, cue(40000))
  assert.equal(pressActiveLoop(cues, 0).deck, cues)
  assert.equal(activeLoopLit(on.deck), true)
  assert.equal(activeLoopLit({ ...on.deck, loop: looping({ in: 100000, out: 180000 }) }), true)
  assert.equal(activeLoopLit(called), false)
  assert.equal(activeLoopLit({ ...on.deck, loop: NO_LOOP }), false)
})

test('T5: an Active Loop engages when play crosses its in point; not inactive, a seek, another looping, from inside; the earlier', () => {
  const deck = saved(playing, loop(100000, 180000, true), loop(102000, 104000, true), loop(300000, 380000))
  assert.deepEqual(reached(deck, 99000, 101000, MOST), { in: 100000, out: 180000 })
  assert.deepEqual(reached(deck, 100000, 100500, MOST), { in: 100000, out: 180000 }, 'from its in point')
  assert.deepEqual(reached(deck, 101000, 103000, MOST), { in: 102000, out: 104000 })
  assert.equal(reached(deck, 299000, 301000, MOST), null, 'not active')
  assert.equal(reached(deck, 99000, 101000, 1000), null, 'a seek over it')
  assert.equal(reached({ ...deck, loop: looping({ in: 0, out: 20000 }) }, 99000, 101000, MOST), null)
  assert.equal(reached(deck, 120000, 130000, MOST), null, 'from inside, as after an exit')
  assert.equal(reached(deck, 101000, 99000, MOST), null)
  assert.deepEqual(engaged(deck, { in: 100000, out: 180000 }).loop, looping({ in: 100000, out: 180000 }))
})

test('T6: hot cues and memory points apart; an engaged memory loop moved is no longer called', () => {
  const both = { ...saved(paused, ...SAVED), cue: 40000, quantize: false, hotCues: NO_HOT_CUES.map((c, i) => (i === 0 ? ({ kind: 'cue', at: 5 } as const) : c)) }
  for (const step of [pressMemory(both), pressCall(both, 1, 0), pressDelete(both), pressActiveLoop(both, 0)]) assert.equal(step.deck.hotCues, both.hotCues)
  assert.equal(pressPad(both, 1, 7, grid).deck.memoryCues, both.memoryCues)
  assert.equal(pressShiftPad(both, 0).deck.memoryCues, both.memoryCues)
  const playingLoop = { ...saved(playing, loop(100000, 180000, true)), loop: looping({ in: 100000, out: 180000 }) }
  assert.equal(activeLoopLit(playingLoop), true)
  assert.equal(activeLoopLit({ ...playingLoop, loop: looping({ in: 180000, out: 260000 }) }), false, 'moved by a beat jump, no longer called')
})

test('T7: a load keeps the memory points', () => {
  const deck: DeckState = { ...paused, reverse: false, touched: false, vinyl: true, tempo: 0.5, tempoRange: 0.1, masterTempo: true, keyShift: 0, keySync: false, locked: null, quantize: true, hotCues: NO_HOT_CUES, memoryCues: SAVED }
  assert.equal(loadedState(deck).memoryCues, SAVED)
})
