// Concern: checks the key shift spec's T1, T2, T4, T5: pads' pitches, a shift set, clamped, KEY SYNC matching and refused, Keyboard choosing and calling | Non-concern: the controls | IO: none
import assert from 'node:assert/strict'
import test from 'node:test'
import { NO_HOT_CUES, type HotCues } from '../../shared/transport/hot-cue-state.ts'
import type { Key } from '../../shared/transport/key.ts'
import type { KeyedDeck } from '../../shared/transport/key.ts'
import { KeySyncRefused, pitchOf, pressKeyboard, pressKeySync, shiftedTo, syncedShift } from './semitones.ts'

const D_MINOR: Key = { tonic: 2, minor: true }
const deck = (index: number, state: Partial<KeyedDeck['state']> = {}, key = D_MINOR): KeyedDeck => ({
  index,
  key,
  state: { loaded: true, locked: { bpm: 144, semitones: 0 }, tempo: 0.5, tempoRange: 0.1, keyShift: 0, keySync: false, ...state },
})

test('T1: page 1 pads 1-8 are +4 +5 +6 +7 over 0 +1 +2 +3 (MAN p.86); page 2 -3 -2 -1 0 over -7 -6 -5 -4', () => {
  assert.deepEqual(Array.from({ length: 8 }, (_, pad) => pitchOf(0, pad)), [4, 5, 6, 7, 0, 1, 2, 3])
  assert.deepEqual(Array.from({ length: 8 }, (_, pad) => pitchOf(1, pad)), [-3, -2, -1, 0, -7, -6, -5, -4])
})

test('T2: a pad or semitone sets the shift, clamped at ±12, key sync ending', () => {
  assert.deepEqual(shiftedTo(3), { keyShift: 3, keySync: false })
  assert.deepEqual([shiftedTo(13), shiftedTo(-13)], [{ keyShift: 12, keySync: false }, { keyShift: -12, keySync: false }])
})

test('T4: KEY SYNC matches the key the other deck sounds in now, shifted or moved by TEMPO unlocked; pressed again it keeps the key', () => {
  assert.deepEqual(pressKeySync(deck(0), deck(1, { locked: { bpm: 144, semitones: 3 } })), { keyShift: 3, keySync: true })
  assert.deepEqual(pressKeySync(deck(0), deck(1, { locked: null, tempo: 1, tempoRange: 0.16 })), { keyShift: 3, keySync: true })
  assert.equal(syncedShift(deck(0, {}, { tonic: 9, minor: true }), deck(1)), 5, 'A minor to D minor, up a fourth')
  assert.deepEqual(pressKeySync(deck(0, { keyShift: 3, keySync: true }), deck(1, { locked: { bpm: 144, semitones: -2 } })), { keyShift: -2, keySync: false }, 'the key it follows now')
})

test('T4: KEY SYNC with either deck unloaded, or the other at a standstill, is refused, naming the deck', () => {
  assert.throws(() => pressKeySync(deck(0), deck(1, { loaded: false })), (err: unknown) => err instanceof KeySyncRefused && /deck 2 has no song loaded/.test(err.message))
  assert.throws(() => pressKeySync(deck(0, { loaded: false }), deck(1)), /deck 1 has no song loaded/)
  assert.throws(() => pressKeySync(deck(0), deck(1, { locked: null, tempo: 0, tempoRange: 1 })), /deck 2 stands still/)
})

const cued: HotCues = NO_HOT_CUES.map((c, slot) => (slot === 2 ? { kind: 'cue', at: 1000 } : c))

test('T5: choosing, a set hot cue is chosen without playing; an empty one is set, as a HOT CUE pad sets it, and chosen', () => {
  assert.deepEqual(pressKeyboard(null, cued, 0, 2), { chosen: 2, hotCue: null, semitones: null })
  assert.deepEqual(pressKeyboard(null, cued, 1, 0), { chosen: 8, hotCue: 8, semitones: null }, 'page 2 pad 1 is hot cue I')
})

test('T5: chosen, a pad calls the hot cue at its pitch; a choice since cleared chooses again', () => {
  assert.deepEqual(pressKeyboard(2, cued, 0, 0), { chosen: 2, hotCue: 2, semitones: 4 })
  assert.deepEqual(pressKeyboard(2, cued, 1, 4), { chosen: 2, hotCue: 2, semitones: -7 })
  assert.deepEqual(pressKeyboard(5, cued, 0, 2), { chosen: 2, hotCue: null, semitones: null })
})
