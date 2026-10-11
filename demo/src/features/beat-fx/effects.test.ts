// Concern: checks the Beat FX spec's T1 and T4: positions and names, each effect's list and default, every parameter's text, the 7 targets and their points | Non-concern: the rules, the audio | IO: none
import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULTS, EFFECTS, KINDS, LISTS, NAMES, paramText, pointFor, TARGET_LABELS, TARGETS } from './effects.ts'

const ascii = (text: string) => /^[\x20-\x7e]+$/.test(text)

test('T1: the BEAT FX knob\'s 14 positions in MML F13 order, each with its own name the display fits', () => {
  assert.deepEqual(EFFECTS, ['lowCutEcho', 'echo', 'mtDelay', 'spiral', 'reverb', 'trans', 'enigmaJet', 'flanger', 'phaser', 'stretch', 'slipRoll', 'roll', 'mobiusSaw', 'mobiusTri'])
  assert.equal(new Set(EFFECTS.map((e) => NAMES[e])).size, 14)
  for (const e of EFFECTS) assert.ok(ascii(NAMES[e]) && NAMES[e].length <= 32, `${NAMES[e]} fits the display's name`)
})

test('T1: each effect steps the range MAN pp.94-98 give it, from its default', () => {
  const span = (e: (typeof EFFECTS)[number]) => [LISTS[KINDS[e]][0], LISTS[KINDS[e]].at(-1)]
  for (const e of ['lowCutEcho', 'echo', 'mtDelay', 'spiral', 'trans', 'stretch', 'slipRoll', 'roll'] as const) assert.deepEqual(span(e), [1 / 16, 16], e)
  for (const e of ['flanger', 'phaser'] as const) assert.deepEqual(span(e), [1 / 16, 64], e)
  for (const e of ['enigmaJet', 'mobiusSaw', 'mobiusTri'] as const) {
    assert.deepEqual(span(e), [-64, 64], e)
    assert.ok(!LISTS[KINDS[e]].includes(0))
    assert.ok(LISTS[KINDS[e]].includes(-1 / 16) && LISTS[KINDS[e]].includes(1 / 16))
  }
  assert.deepEqual(span('reverb'), [1, 100])
  for (const e of EFFECTS) assert.ok(LISTS[KINDS[e]].includes(DEFAULTS[KINDS[e]]), e)
  assert.deepEqual([DEFAULTS.beats, DEFAULTS.signed, DEFAULTS.percent], [1, 1, 50])
})

test('T1: every parameter writes in at most 5 ASCII characters, each value of a list its own, signed by its direction, sizes in percent', () => {
  for (const kind of ['beats', 'rate', 'signed', 'percent'] as const) {
    const texts = LISTS[kind].map((value) => paramText(kind, value))
    for (const text of texts) assert.ok(ascii(text) && text.length <= 5, `${kind}: ${text}`)
    assert.equal(new Set(texts).size, texts.length, kind)
  }
  for (const value of LISTS.signed) assert.equal(paramText('signed', value)[0], value > 0 ? '+' : '-')
  for (const value of LISTS.percent) assert.ok(paramText('percent', value).endsWith('%'))
  assert.throws(() => paramText('beats', 3), RangeError)
})

test('T1: the BEAT FX CH knob\'s 7 positions in MML F14 order, each with its own label', () => {
  assert.deepEqual(TARGETS, ['channel1', 'channel2', 'channel3', 'channel4', 'master', 'mic', 'sampler'])
  assert.equal(new Set(TARGETS.map((t) => TARGET_LABELS[t])).size, 7)
})

test('T4: the target names the FX point the unit sits on; the demo has no CH 3, CH 4 or microphone', () => {
  const points = { channels: ['ch1', 'ch2'] as const, sampler: 'sp', master: 'mst' }
  assert.deepEqual(
    TARGETS.map((t) => pointFor(points, t)),
    ['ch1', 'ch2', null, null, 'mst', null, 'sp'],
  )
})
