// Concern: checks Sound Color FX's rules: one effect selected, cancelled by its own button, COLOR's centre and ends, each effect's two turns (MAN pp.99-101) | Non-concern: tuning, audio | IO: none
import assert from 'node:assert/strict'
import test from 'node:test'
import { colourOf, EFFECTS, NONE, pressed, settingsOf } from './rules.ts'

test('a button selects its effect, another takes over, the selected one cancels (MAN p.99)', () => {
  assert.equal(pressed(null, 'filter'), 'filter')
  assert.equal(pressed('filter', 'crush'), 'crush')
  assert.equal(pressed('crush', 'crush'), null)
})

test('COLOR is nothing at its centre, -1 fully counterclockwise, 1 fully clockwise, and only rises between', () => {
  assert.deepEqual([colourOf(0), colourOf(0.5), colourOf(1)], [-1, 0, 1])
  for (let p = 0.01; p <= 1; p += 0.01) assert.ok(colourOf(p) >= colourOf(p - 0.01))
})

test('no effect, or COLOR at its centre, leaves the channel as it comes', () => {
  assert.deepEqual(settingsOf(null, 0.7), NONE)
  for (const effect of EFFECTS) assert.deepEqual(settingsOf(effect, 0), NONE)
})

test('every effect changes the sound either way, differently each way and from every other effect', () => {
  const seen = EFFECTS.flatMap((effect) => [-0.6, 0.6].map((colour) => JSON.stringify(settingsOf(effect, colour))))
  assert.equal(new Set([...seen, JSON.stringify(NONE)]).size, 13)
})

test('FILTER closes a low-pass counterclockwise and opens a high-pass clockwise, further the further it turns (MAN p.101)', () => {
  assert.ok(settingsOf('filter', -1).lowpass < settingsOf('filter', -0.5).lowpass && settingsOf('filter', -0.5).lowpass < NONE.lowpass)
  assert.ok(settingsOf('filter', 1).highpass > settingsOf('filter', 0.5).highpass && settingsOf('filter', 0.5).highpass > NONE.highpass)
  assert.equal(settingsOf('filter', -1).highpass, NONE.highpass)
})

test('PITCH falls counterclockwise and rises clockwise; CRUSH adds a high-pass only clockwise; NOISE moves its filter each way (MAN p.100)', () => {
  assert.ok(settingsOf('pitch', -0.5).pitch < 1 && settingsOf('pitch', 0.5).pitch > 1)
  assert.equal(settingsOf('crush', -0.5).highpass, NONE.highpass)
  assert.ok(settingsOf('crush', 0.5).highpass > NONE.highpass && settingsOf('crush', 0.5).crush === settingsOf('crush', -0.5).crush)
  assert.ok(settingsOf('noise', -0.5).noise.lowpass < NONE.lowpass && settingsOf('noise', 0.5).noise.highpass > NONE.highpass)
})

test('DUB ECHO takes the mid-range counterclockwise and the high clockwise; SPACE the mids with the lows, then with the highs (MAN pp.99-100)', () => {
  assert.deepEqual([settingsOf('dubEcho', -1).echo.band, settingsOf('dubEcho', 1).echo.band], ['mid', 'high'])
  assert.deepEqual([settingsOf('space', -1).space.band, settingsOf('space', 1).space.band], ['low', 'high'])
})
