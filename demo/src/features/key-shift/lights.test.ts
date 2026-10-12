// Concern: checks the key shift spec's T7: each pad painted as its pitch on both pages and SHIFT, PAGE LEDs, Keyboard's hot cues, the jog screen's key | Non-concern: the colours chosen | IO: none
import assert from 'node:assert/strict'
import test from 'node:test'
import { cueColour } from '../../shared/hot-cues/lights.ts'
import type { ModeViews, Output, Steady } from '../../shared/lights/show-lights.ts'
import { NO_HOT_CUES } from '../../shared/transport/hot-cue-state.ts'
import { NO_LOOP } from '../../shared/transport/loop-state.ts'
import { jogScreenKey, keyboardPlan, pitchColour, pitchPlan } from './lights.ts'
import { pitchOf } from './semitones.ts'

const out = <T>(): Output<T> => ({ base: undefined, set: async () => {}, play: async () => {} })
const page = () => ({ pads: Array.from({ length: 8 }, () => out<number>()), shifted: Array.from({ length: 8 }, () => out<number>()) })
const views: ModeViews = { pages: [page(), page()], left: out<boolean>(), right: out<boolean>() }
const valueAt = (steady: readonly Steady[], o: Output<number> | Output<boolean>) => steady.find((s) => s.out === o)?.value

test('T7: every pad on both pages, plain and SHIFT alike, painted as its own pitch against the pitch asked', () => {
  const { steady } = pitchPlan(views, 2, null)
  views.pages.forEach(({ pads, shifted }, p) => {
    const expected = Array.from({ length: 8 }, (_, i) => pitchColour(pitchOf(p, i), 2))
    assert.deepEqual(pads.map((o) => valueAt(steady, o)), expected)
    assert.deepEqual(shifted.map((o) => valueAt(steady, o)), expected)
  })
})

test('T7: PAGE ◀ lit on page 1, ▶ on page 2 while the mode shows, neither written otherwise', () => {
  const leds = (p: number | null) => [valueAt(pitchPlan(views, 0, p).steady, views.left), valueAt(pitchPlan(views, 0, p).steady, views.right)]
  assert.deepEqual([leds(0), leds(1), leds(null)], [[true, false], [false, true], [undefined, undefined]])
})

test('T7: Keyboard choosing lights the hot cues as HOT CUE mode does; chosen, the pitches', () => {
  const deck = { loop: NO_LOOP, hotCues: NO_HOT_CUES.map((c, slot) => (slot === 0 ? ({ kind: 'cue', at: 0 } as const) : c)) }
  const first = views.pages[0]?.pads[0]
  assert.ok(first)
  assert.equal(valueAt(keyboardPlan(views, deck, 0, true, 0).steady, first), cueColour(0))
  assert.equal(valueAt(keyboardPlan(views, deck, 0, false, 0).steady, first), pitchColour(pitchOf(0, 0), 0))
})

test('T7: the jog screen shows the current key and its change as the library labels them; none unloaded', () => {
  const dMinor = { tonic: 2, minor: true }
  const at = (semitones: number) => jogScreenKey({ loaded: true, locked: { bpm: 144, semitones }, tempo: 0.5, tempoRange: 0.1 }, dMinor)
  assert.deepEqual([at(0), at(3), at(-2)], [{ key: 'Dm', change: '0' }, { key: 'Fm', change: '+3' }, { key: 'Cm', change: '-2' }])
  assert.deepEqual(jogScreenKey({ loaded: false, locked: null, tempo: 0.5, tempoRange: 0.1 }, dMinor), { key: '---', change: '0' })
})
