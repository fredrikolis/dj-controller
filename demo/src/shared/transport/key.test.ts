// Concern: checks the key shift spec's T3 and T4's matching: keys named as the FLX10 lists them, the current key locked and unlocked, the shift syncing two keys | Non-concern: the controls | IO: none
import assert from 'node:assert/strict'
import test from 'node:test'
import { askedShift, currentKey, keyName, keyOffset, syncShift, type Key, type KeyedDeck } from './key.ts'

const D_MINOR: Key = { tonic: 2, minor: true }
const unlocked = { locked: null, tempoRange: 0.16 } as const

test('T3: every key named as the FLX10’s list spells it (MML p.7 *3)', () => {
  const majors = Array.from({ length: 12 }, (_, tonic) => keyName({ tonic, minor: false }))
  const minors = Array.from({ length: 12 }, (_, tonic) => keyName({ tonic, minor: true }))
  assert.deepEqual(majors, ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'])
  assert.deepEqual(minors, ['Cm', 'Dbm', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'Abm', 'Am', 'Bbm', 'Bm'])
})

test('T3: key-locked, the current key is the song’s moved by the held render’s semitones, whatever TEMPO says', () => {
  const name = (semitones: number) => keyName(currentKey({ ...unlocked, tempo: 1, locked: { bpm: 167, semitones } }, D_MINOR) ?? D_MINOR)
  assert.deepEqual([-12, -1, 0, 3, 12].map(name), ['Dm', 'Dbm', 'Dm', 'Fm', 'Dm'])
})

test('T3: unlocked, TEMPO’s pitch moves the key to the nearest semitone (RB p.130 item 11), none at a standstill', () => {
  // ±16%: +16% is 2.57 semitones, -16% -3.02, +2.8% at 0.5875 under half a semitone.
  assert.deepEqual([1, 0, 0.5875, 0.5].map((tempo) => keyOffset({ ...unlocked, tempo })), [3, -3, 0, 0])
  assert.equal(keyOffset({ locked: null, tempoRange: 1, tempo: 0 }), null)
})

test('T4: key sync shifts by -6 to +5 to the same key, a minor key meeting its relative major', () => {
  const minor = (tonic: number): Key => ({ tonic, minor: true })
  const major = (tonic: number): Key => ({ tonic, minor: false })
  assert.equal(syncShift(D_MINOR, D_MINOR), 0)
  assert.equal(syncShift(D_MINOR, minor(5)), 3)
  assert.equal(syncShift(D_MINOR, minor(8)), -6)
  assert.equal(syncShift(D_MINOR, minor(7)), 5)
  assert.equal(syncShift(D_MINOR, major(5)), 0, 'F major is D minor’s relative')
  assert.equal(syncShift(major(0), minor(9)), 0, 'A minor is C major’s relative')
})

const keyed = (index: number, state: Partial<KeyedDeck['state']> = {}): KeyedDeck => ({
  index,
  key: D_MINOR,
  state: { loaded: true, locked: { bpm: 144, semitones: 0 }, tempo: 0.5, tempoRange: 0.1, keyShift: 0, keySync: false, ...state },
})

test('T4: synced, the shift asked follows the key the other deck sounds in now; unsynced it is the deck’s own; with nothing to follow, the shift it synced to', () => {
  const other = keyed(1, { locked: { bpm: 144, semitones: -2 } })
  assert.equal(askedShift(keyed(0, { keySync: true, keyShift: 3 }), other), -2)
  assert.equal(askedShift(keyed(0, { keyShift: 3 }), other), 3)
  assert.equal(askedShift(keyed(0, { keySync: true, keyShift: 3 }), keyed(1, { loaded: false })), 3)
  assert.equal(askedShift(keyed(0, { keySync: true, keyShift: 3 }), keyed(1, { locked: null, tempo: 0, tempoRange: 1 })), 3)
})
