// Concern: checks what is rendered ahead: each pitch at the BPM a press would lock to, none for the song as loaded, none unloaded | Non-concern: the render loop | IO: none
import assert from 'node:assert/strict'
import test from 'node:test'
import type { DeckState } from '../../shared/transport/deck-state.ts'
import { NO_HOT_CUES } from '../../shared/transport/hot-cue-state.ts'
import { NO_LOOP } from '../../shared/transport/loop-state.ts'
import { NO_MEMORY_CUES } from '../../shared/transport/memory-cue-state.ts'
import { aheadOf } from './ahead.ts'

const deck: DeckState = { loaded: true, playing: false, reverse: false, touched: false, vinyl: true, tempo: 0.5, tempoRange: 0.1, cue: 0, previewing: false, masterTempo: false, keyShift: 0, keySync: false, locked: null, quantize: true, loop: NO_LOOP, hotCues: NO_HOT_CUES, memoryCues: NO_MEMORY_CUES }

test('each pitch is rendered at the fader’s BPM, key-locked as a press would ask, master tempo off or on; 0 at the song’s BPM is the song as loaded', () => {
  assert.deepEqual(aheadOf(deck, 144, [0, 3, -7]), [{ at: 144, semitones: 3 }, { at: 144, semitones: -7 }])
  assert.deepEqual(aheadOf({ ...deck, tempo: 1 }, 144, [0, 3]), [{ at: 158.4, semitones: 0 }, { at: 158.4, semitones: 3 }])
})

test('nothing ahead for a deck with no song', () => {
  assert.deepEqual(aheadOf({ ...deck, loaded: false }, 144, [3]), [])
})
