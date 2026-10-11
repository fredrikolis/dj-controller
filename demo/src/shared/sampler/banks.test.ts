// Concern: checks the sampler spec's T1: 4 banks of 16, a deck's pad as its position, loops' bars, each slot its own sound | Non-concern: which sounds the banks hold | IO: none
import assert from 'node:assert/strict'
import test from 'node:test'
import { BANKS, LOOP_BARS, POSITIONS, positionOf, SAMPLER_BANKS, SLOTS, slotAt } from './banks.ts'

test('T1: deck 1 pads 1-8 are slots 1-8 and deck 2 pads 1-8 slots 9-16 (MAN p.84, "Playing Sampler sounds" step 4)', () => {
  assert.deepEqual(Array.from({ length: 8 }, (_, pad) => positionOf(0, pad)), [0, 1, 2, 3, 4, 5, 6, 7])
  assert.deepEqual(Array.from({ length: 8 }, (_, pad) => positionOf(1, pad)), [8, 9, 10, 11, 12, 13, 14, 15])
  assert.throws(() => positionOf(2, 0), RangeError)
  assert.throws(() => positionOf(0, 8), RangeError)
})

test('T1: 4 banks of 16 slots (RB p.194); a loop repeats 1, 2 or 4 bars and nothing else has bars; each slot its own sound', () => {
  assert.equal(SAMPLER_BANKS.length, BANKS)
  for (const bank of SAMPLER_BANKS) assert.equal(bank.length, POSITIONS)
  for (const slot of SLOTS) assert.equal(slot.mode === 'loop' ? LOOP_BARS.includes(slot.bars ?? 0) : slot.bars === null, true, slot.name)
  assert.equal(new Set(SLOTS.map((s) => s.node)).size, SLOTS.length)
  assert.throws(() => slotAt(BANKS, 0), RangeError)
  assert.throws(() => slotAt(0, POSITIONS), RangeError)
})
