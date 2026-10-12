// Concern: checks the key shift spec's T7 jog screen: the current key and its change as the FLX10 labels them, none unloaded | Non-concern: the pads' colours | IO: none
import assert from 'node:assert/strict'
import test from 'node:test'
import { jogScreenKey } from './lights.ts'

test('T7: the jog screen shows the current key and its change as the library labels them; none unloaded', () => {
  const dMinor = { tonic: 2, minor: true }
  const at = (semitones: number) => jogScreenKey({ loaded: true, locked: { bpm: 144, semitones }, tempo: 0.5, tempoRange: 0.1 }, dMinor)
  assert.deepEqual([at(0), at(3), at(-2)], [{ key: 'Dm', change: '0' }, { key: 'Fm', change: '+3' }, { key: 'Cm', change: '-2' }])
  assert.deepEqual(jogScreenKey({ loaded: false, locked: null, tempo: 0.5, tempoRange: 0.1 }, dMinor), { key: '---', change: '0' })
})
