// Concern: checks vinyl mode as rekordbox plays it on a DDJ-FLX10: a touch holding the platter only with it on and SHIFT up, a switch letting go | Non-concern: the jog's turns | IO: none
import assert from 'node:assert/strict'
import test from 'node:test'
import { holds, switched } from './vinyl.ts'

test('a touch holds the platter in vinyl mode only, and never with SHIFT (MAN p.20)', () => {
  assert.deepEqual([holds(false, true), holds(true, true), holds(false, false), holds(true, false)], [true, false, false, false])
})

test('SHIFT+SLIP switches vinyl mode either way and lets go of a platter held mid-touch (MAN p.16)', () => {
  assert.deepEqual([switched({ vinyl: true }), switched({ vinyl: false })], [{ vinyl: false, touched: false }, { vinyl: true, touched: false }])
})
