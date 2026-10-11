// Concern: checks TAP's TEMPO: the fader set where the tapped BPM plays within its range, at its end past it | Non-concern: the taps (shared/tap.test.ts), the buttons | IO: none
import assert from 'node:assert/strict'
import test from 'node:test'
import { tempoFor } from './tap.ts'

test('the fader goes where the tapped BPM plays in its range, to its end past it', () => {
  assert.equal(tempoFor({ tempoRange: 0.1 }, 144, 144), 0.5)
  assert.ok(Math.abs(tempoFor({ tempoRange: 0.16 }, 144 * 1.08, 144) - 0.75) < 1e-12)
  assert.deepEqual([tempoFor({ tempoRange: 0.06 }, 200, 144), tempoFor({ tempoRange: 0.06 }, 60, 144), tempoFor({ tempoRange: 1 }, 72, 144)], [1, 0, 0.25])
})
