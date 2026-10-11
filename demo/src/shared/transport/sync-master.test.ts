// Concern: checks the sync master: the chosen deck whatever plays, else the deck playing, deck 1 when both or neither play | Non-concern: what follows the master | IO: none
import assert from 'node:assert/strict'
import test from 'node:test'
import { masterOf } from './sync-master.ts'

test('a chosen deck is the master whatever plays (MAN p.17, RB p.168)', () => {
  for (const playing of [[false, false], [true, false], [false, true], [true, true]] as const) {
    assert.equal(masterOf(0, playing), 0)
    assert.equal(masterOf(1, playing), 1)
  }
})

test('with none chosen the master is the deck playing, deck 1 when both or neither play', () => {
  assert.equal(masterOf(null, [false, true]), 1)
  assert.equal(masterOf(null, [true, false]), 0)
  assert.equal(masterOf(null, [true, true]), 0)
  assert.equal(masterOf(null, [false, false]), 0)
})
