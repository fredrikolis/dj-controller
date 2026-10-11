// Concern: checks the CDJ rules: cue returning, setting, previewing, play keeping a preview, an empty deck, SHIFT+CUE, SHIFT+PLAY, SHIFT+SLIP REVERSE | Non-concern: the audio | IO: none
import assert from 'node:assert/strict'
import test from 'node:test'
import type { Grid } from '../../shared/transport/grid.ts'
import { pressCue, pressPlay, pressReverse, releaseCue, type Cdj } from './cdj.ts'

const deck: Cdj = { loaded: true, playing: false, cue: 0, previewing: false }
const grid: Grid = { first: 0, beat: 20000, end: 32 * 20000 }

test('cue while playing returns to the cue point and pauses', () => {
  const { deck: next, seek } = pressCue({ ...deck, playing: true, cue: 100 }, false, 5000, grid)
  assert.deepEqual([next.playing, seek], [false, 100])
})

test('cue while paused sets the cue point off it, and on it previews until let go', () => {
  const set = pressCue(deck, false, 5000, grid).deck
  assert.deepEqual([set.cue, set.playing], [5000, false])
  const preview = pressCue(set, false, 5000, grid).deck
  assert.equal(preview.playing, true)
  const { deck: back, seek } = releaseCue(preview)
  assert.deepEqual([back.playing, seek], [false, 5000])
})

test('play during a preview keeps playing after cue is let go', () => {
  const kept = pressPlay(pressCue(deck, false, 0, grid).deck, false).deck
  assert.deepEqual([releaseCue(kept).deck.playing, releaseCue(kept).seek], [true, null])
})

test('an empty deck ignores play and cue, SHIFT or not', () => {
  const empty = { ...deck, loaded: false }
  for (const shift of [false, true]) assert.deepEqual([pressPlay(empty, shift).deck.playing, pressCue(empty, shift, 10, grid)], [false, { deck: empty, seek: null }])
})

test('SHIFT+CUE returns to the grid’s first beat, playing or paused, the cue point and play state kept, and its release changes nothing', () => {
  const late: Grid = { ...grid, first: 1200 }
  for (const playing of [false, true]) {
    const from = { ...deck, playing, cue: 9000 }
    const step = pressCue(from, true, 5000, late)
    assert.deepEqual(step, { deck: from, seek: 1200 })
    assert.deepEqual(releaseCue(step.deck), { deck: from, seek: null })
  }
})

test('SHIFT+PLAY changes nothing, playing, paused or previewing', () => {
  for (const d of [deck, { ...deck, playing: true }, { ...deck, playing: true, previewing: true }]) assert.deepEqual(pressPlay(d, true), { deck: d, seek: null })
})

test('SHIFT+SLIP REVERSE switches reverse either way; the plain press and an empty deck change nothing (MAN p.21)', () => {
  const forward = { loaded: true, reverse: false }
  assert.deepEqual(pressReverse(forward, true), { loaded: true, reverse: true })
  assert.deepEqual(pressReverse({ loaded: true, reverse: true }, true), forward)
  assert.equal(pressReverse(forward, false), forward)
  const empty = { loaded: false, reverse: false }
  assert.equal(pressReverse(empty, true), empty)
})
