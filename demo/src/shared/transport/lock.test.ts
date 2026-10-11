// Concern: checks a deck's key lock: the fader's BPM per range, pending till rendered, none unlocked, the slowest render; a shifted or synced key held (T2) | Non-concern: the fader's curve | IO: none
import assert from 'node:assert/strict'
import test from 'node:test'
import { nextRange, TEMPO_RANGES, type TempoRange } from './tempo.ts'
import { playingBpm } from './bpm.ts'
import { lockedAt, pendingBpm, pendingShift, renderedAt, type Tempo } from './lock.ts'

const deck: Tempo = { tempo: 0.5, tempoRange: 0.1, masterTempo: true, keyShift: 0, keySync: false, locked: { bpm: 144, semitones: 0 } }

test('key lock plays the song’s own BPM at the fader’s centre, nothing pending', () => {
  assert.deepEqual(lockedAt(deck, 144, 0), { bpm: 144, semitones: 0 })
  assert.deepEqual([pendingBpm(deck, 144), pendingShift(deck, 0)], [null, null])
})

test('a moved fader is pending under key lock until its render plays, which then sets the BPM', () => {
  const moved = { ...deck, tempo: 1 }
  const asked = lockedAt(moved, 144, 0)
  assert.ok(asked !== null && asked.bpm > 144)
  assert.deepEqual([pendingBpm(moved, 144), playingBpm(moved, 144)], [asked.bpm, 144])
  const rendered = { ...moved, locked: asked }
  assert.deepEqual([pendingBpm(rendered, 144), playingBpm(rendered, 144)], [null, asked.bpm])
})

test('unlocked, the deck plays at the fader’s rate at once and renders nothing', () => {
  const unlocked = { ...deck, tempo: 1, masterTempo: false, locked: null }
  assert.equal(lockedAt(unlocked, 144, 0), null)
  assert.deepEqual([pendingBpm(unlocked, 144), pendingShift(unlocked, 0)], [null, null])
  assert.ok(playingBpm(unlocked, 144) > 144)
})

test('T2: a shifted key asks a key-locked render at the fader’s BPM with its semitones, master tempo off or on; pending until it plays', () => {
  for (const masterTempo of [false, true]) {
    const shifted = { ...deck, masterTempo, tempo: 1, keyShift: 3, locked: null }
    assert.deepEqual(lockedAt(shifted, 144, 3), { bpm: 158.4, semitones: 3 })
    assert.deepEqual([pendingBpm(shifted, 144), pendingShift(shifted, 3)], [158.4, 3])
    const playing = { ...shifted, locked: { bpm: 158.4, semitones: 3 } }
    assert.deepEqual([pendingBpm(playing, 144), pendingShift(playing, 3)], [null, null])
  }
})

test('T2: key sync holds the key with master tempo off, at no shift as at any', () => {
  assert.deepEqual(lockedAt({ ...deck, masterTempo: false, keySync: true }, 144, 0), { bpm: 144, semitones: 0 })
})

test('SHIFT+TEMPO RESET steps ±6%, ±10%, ±16%, WIDE and back to ±6% (MAN p.17), each the fader’s ends, key-locked or not', () => {
  let range: TempoRange = 0.06
  const steps: TempoRange[] = [range]
  for (let i = 0; i < 4; i++) steps.push((range = nextRange(range)))
  assert.deepEqual(steps, [0.06, 0.1, 0.16, 1, 0.06])
  const ends = <T>(bpm: (tempoRange: TempoRange, tempo: number) => T) => TEMPO_RANGES.map((tempoRange) => [0, 1].map((tempo) => bpm(tempoRange, tempo)))
  const expected = [[94, 106], [90, 110], [84, 116], [0, 200]]
  assert.deepEqual(ends((tempoRange, tempo) => lockedAt({ ...deck, tempo, tempoRange }, 100, 0)?.bpm), expected)
  assert.deepEqual(ends((tempoRange, tempo) => Math.round(playingBpm({ tempo, tempoRange, locked: null }, 100) * 1e6) / 1e6), expected)
})

test('key lock renders at the BPM asked down to half the song’s tempo, and the slowest render under that, to WIDE’s 0', () => {
  assert.deepEqual([288, 144, 72.1, 72, 71.9, 0].map((locked) => renderedAt(locked, 144)), [288, 144, 72.1, 72, 72, 72])
})
