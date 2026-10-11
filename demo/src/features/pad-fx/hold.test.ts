// Concern: checks the PAD FX spec's T1-T4: the banks' slots A to AF, holds on and off, the same effect's last press, a Release FX clearing the rest, BEAT steps | Non-concern: the audio | IO: none
import assert from 'node:assert/strict'
import test from 'node:test'
import { BEATS } from '../../shared/fx/beats.ts'
import { RELEASE_FX, SLOTS, slotAt, slotOf } from './banks.ts'
import { activeOf, bufferOf, isOn, letGo, NOTHING_HELD, pressed, stepped, type Holding } from './hold.ts'

const named = (h: Holding) => activeOf(h).map((a) => slotOf(a.slot).letter)
const slot = (letter: string) => SLOTS.findIndex((s) => s.letter === letter)

test('T1: PAD FX1 pages hold A-H and I-P, PAD FX2 Q-X and Y-AF, pads 1-8 in order; beats on the Beat FX list; Release FX on PAD FX2 page 2 alone', () => {
  const letters = (bank: number, page: number) => Array.from({ length: 8 }, (_, pad) => slotOf(slotAt(bank, page, pad)).letter).join(' ')
  assert.equal(letters(0, 0), 'A B C D E F G H')
  assert.equal(letters(0, 1), 'I J K L M N O P')
  assert.equal(letters(1, 0), 'Q R S T U V W X')
  assert.equal(letters(1, 1), 'Y Z AA AB AC AD AE AF')
  assert.throws(() => slotAt(2, 0, 0), RangeError)
  assert.throws(() => slotAt(0, 0, 8), RangeError)
  for (const { timing } of SLOTS) if (timing !== null && 'beats' in timing) assert.ok(BEATS.includes(timing.beats), `${timing.beats} beats`)
  const releases = SLOTS.flatMap((s, i) => (RELEASE_FX.has(s.effect) ? [i] : []))
  assert.ok(releases.length > 0 && releases.every((i) => i >= slotAt(1, 1, 0)))
})

test('T2: a press turns its effect on and its release off; different effects stack', () => {
  const echo = pressed(NOTHING_HELD, 1, slot('A'))
  assert.deepEqual(named(echo), ['A'])
  const both = pressed(echo, 2, slot('E'))
  assert.deepEqual(named(both), ['A', 'E'])
  assert.deepEqual(named(letGo(both, 1)), ['E'])
  assert.deepEqual(named(letGo(letGo(both, 1), 2)), [])
  assert.throws(() => pressed(both, 2, slot('G')), /already held/)
})

test('T2: the same effect at other beats leaves the last press alone on, the earlier off even after the later is let go', () => {
  const half = pressed(NOTHING_HELD, 1, slot('A'))
  const threeQuarters = pressed(half, 2, slot('B'))
  assert.deepEqual(named(threeQuarters), ['B'])
  assert.equal(isOn(threeQuarters, slot('A')), false)
  assert.deepEqual(named(letGo(threeQuarters, 2)), [])
})

test('T2: a Release FX turns every other effect off, its release leaves none on; a pad pressed during it adds', () => {
  const held = pressed(pressed(NOTHING_HELD, 1, slot('A')), 2, slot('I'))
  const braking = pressed(held, 3, slot('AA'))
  assert.deepEqual(named(braking), ['AA'])
  assert.deepEqual(named(letGo(braking, 3)), [])
  assert.deepEqual(named(pressed(braking, 4, slot('E'))), ['AA', 'E'])
})

test('T3: BEAT ▶ steps a held beat effect up the list and ◀ down, stopping at the ends; a size stays; nothing held, nothing; gone at release', () => {
  const beatsOf = (h: Holding) => activeOf(h).map((a) => a.timing)
  const echo = pressed(NOTHING_HELD, 1, slot('A'))
  assert.deepEqual(beatsOf(stepped(echo, 1)), [{ beats: 3 / 4 }])
  assert.deepEqual(beatsOf(stepped(echo, -1)), [{ beats: 1 / 4 }])
  let up = echo
  for (let n = 0; n < 20; n++) up = stepped(up, 1)
  assert.deepEqual(beatsOf(up), [{ beats: 16 }])
  let down = echo
  for (let n = 0; n < 20; n++) down = stepped(down, -1)
  assert.deepEqual(beatsOf(down), [{ beats: 1 / 16 }])
  assert.deepEqual(beatsOf(stepped(pressed(NOTHING_HELD, 1, slot('D')), 1)), [{ percent: 60 }])
  assert.deepEqual(stepped(NOTHING_HELD, 1), NOTHING_HELD)
  assert.deepEqual(beatsOf(pressed(letGo(stepped(echo, 1), 1), 2, slot('A'))), [{ beats: 1 / 2 }])
})

test('T2: one buffer effect plays at a time, the newest held', () => {
  const rolls = pressed(pressed(NOTHING_HELD, 1, slot('G')), 2, slot('S'))
  assert.deepEqual(bufferOf(activeOf(rolls)), { effect: 'revRoll', beats: 1 / 2 })
  assert.deepEqual(bufferOf(activeOf(letGo(rolls, 2))), { effect: 'roll', beats: 1 / 4 })
  assert.equal(bufferOf(activeOf(pressed(NOTHING_HELD, 1, slot('A')))), null)
})
