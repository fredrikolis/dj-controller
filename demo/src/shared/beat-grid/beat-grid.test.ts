// Concern: checks that a slopbank pattern's onsets, note lengths and support become bars, and a sound's own timing stays in seconds | Non-concern: rendering | IO: none
import assert from 'node:assert/strict'
import test from 'node:test'
import { barred } from './beat-grid.ts'

test('a pattern’s onsets, note lengths and support are in bars, its support no shorter than written', () => {
  const pattern = 'crop(0.5*(@sva0a(t) + @sva0b(t - 1s, f0=440, len=0.5) + @sva0a(t - 3s, dec=0.2)), 0s, 4.5s)'
  assert.equal(barred(pattern, 2), 'crop(0.5*(@sva0a(t) + @sva0b(t - 0.5b, f0=440, len=0.25b) + @sva0a(t - 1.5b, dec=0.2)), 0s, max(4.5s, 2.25b))')
})

test('a sound’s own timing and its parameters’ defaults stay as written', () => {
  const sound = 'len = 0.4\ncrop(@sva0c(t, f0=f0, len=len)*exp(-t/0.2), 0s, 0.8s, rise=0.002s)'
  assert.equal(barred(sound, 2), sound)
})
