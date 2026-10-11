// Concern: checks fader start: a channel's moves by its fader and by the crossfader per assign, a start from the cue point, a Back Cue, decks left alone | Non-concern: the faders' gains | IO: none
import assert from 'node:assert/strict'
import test from 'node:test'
import type { Assign } from '../../shared/mixer/curves.ts'
import { faderStart, moveOf, type Faders, type Starting } from './fader-start.ts'

const mix = (fader: number, crossfader: number, assign: Assign = 'a'): Faders => ({ channels: [{ fader, assign }, { fader: 1, assign: 'b' }], crossfader })
const paused: Starting = { loaded: true, playing: false, previewing: false, cue: 4800 }

test('a channel fader leaves zero going up from the bottom and reaches it coming back, and moves nothing between (MAN p.91)', () => {
  assert.equal(moveOf(mix(0, 0.5), mix(0.2, 0.5), 0), 'leaves-zero')
  assert.equal(moveOf(mix(0.2, 0.5), mix(0, 0.5), 0), 'reaches-zero')
  assert.equal(moveOf(mix(0.2, 0.5), mix(0.9, 0.5), 0), null)
  assert.equal(moveOf(mix(0, 0.5), mix(0, 0.5), 0), null)
  assert.equal(moveOf(mix(0, 0.5), mix(0.2, 0.5), 1), null, 'the other channel did not move')
})

test('the crossfader moves a channel off its far side and back: A from the right, B from the left, THRU never (MAN p.91)', () => {
  assert.equal(moveOf(mix(1, 1), mix(1, 0.9), 0), 'leaves-zero')
  assert.equal(moveOf(mix(1, 0.9), mix(1, 1), 0), 'reaches-zero')
  assert.equal(moveOf(mix(1, 0), mix(1, 0.1), 1), 'leaves-zero')
  assert.equal(moveOf(mix(1, 0.1), mix(1, 0), 1), 'reaches-zero')
  assert.equal(moveOf(mix(1, 0), mix(1, 0.1), 0), null, 'A is open on the left')
  assert.equal(moveOf(mix(1, 1, 'thru'), mix(1, 0.9, 'thru'), 0), null)
  assert.equal(moveOf(mix(1, 0.9, 'thru'), mix(1, 1, 'thru'), 0), null)
})

test('leaving zero starts a paused deck from its cue point, and leaves a playing deck or a CUE preview as it is (MAN p.91)', () => {
  assert.deepEqual(faderStart(paused, 'leaves-zero'), { deck: { ...paused, playing: true }, seek: 4800 })
  for (const deck of [{ ...paused, playing: true }, { ...paused, playing: true, previewing: true }]) assert.deepEqual(faderStart(deck, 'leaves-zero'), { deck, seek: null })
})

test('reaching zero back-cues a playing deck, ending a CUE preview, and changes nothing paused or unloaded (MAN p.91)', () => {
  assert.deepEqual(faderStart({ ...paused, playing: true }, 'reaches-zero'), { deck: paused, seek: 4800 })
  assert.deepEqual(faderStart({ ...paused, playing: true, previewing: true }, 'reaches-zero'), { deck: paused, seek: 4800 })
  assert.deepEqual(faderStart(paused, 'reaches-zero'), { deck: paused, seek: null })
  const empty = { ...paused, loaded: false }
  for (const move of ['leaves-zero', 'reaches-zero'] as const) assert.deepEqual(faderStart(empty, move), { deck: empty, seek: null })
})
