// Concern: checks the sampler spec's T5: empty dark, loaded in its colour, a blink while playing, both device pages and SHIFT layers, PAGE LEDs by bank | Non-concern: the driver's writes | IO: none
import assert from 'node:assert/strict'
import test from 'node:test'
import type { ModeViews, Output, Plan } from '../../shared/lights/show-lights.ts'
import { slotAt } from '../../shared/sampler/banks.ts'
import { SAMPLER_START } from '../../shared/sampler/sampler-state.ts'
import { EMPTY_COLOUR, KIND_COLOURS, planOf, playingBlink } from './lights.ts'
import { banked, pressed } from './players.ts'

const out = <T>(): Output<T> => ({ base: undefined, set: async () => {}, play: async () => {} })
const page = () => ({ pads: Array.from({ length: 8 }, () => out<number>()), shifted: Array.from({ length: 8 }, () => out<number>()) })
const views: ModeViews = { pages: [page(), page()], left: out<boolean>(), right: out<boolean>() }
const all = () => views.pages.flatMap(({ pads, shifted }) => [pads, shifted])

const valueAt = (plan: Plan, o: Output<number> | Output<boolean>) => plan.steady.find((s) => s.out === o)?.value
const blinkAt = (plan: Plan, o: Output<number>) => plan.blinks.find((b) => b.out === o)?.pattern

test('T5: deck 2\'s pads show slots 9-16 of the bank in their colours on both device pages and SHIFT layers; one playing blinks on each', () => {
  const s = pressed(SAMPLER_START, 9, 1)
  const plan = planOf(views, 1, s, () => true, true)
  const colour = (position: number) => KIND_COLOURS[slotAt(0, position)?.kind ?? 'drum']
  for (const outs of all()) {
    assert.deepEqual(outs.map((o) => valueAt(plan, o)), outs.map((_, pad) => (pad === 1 ? undefined : colour(8 + pad))))
    assert.deepEqual(blinkAt(plan, outs[1] ?? out()), playingBlink(colour(9)))
  }
})

test('T5: an empty or unrendered slot is dark', () => {
  const empty = planOf(views, 0, banked(SAMPLER_START, 3), () => true, false)
  const unrendered = planOf(views, 0, SAMPLER_START, (slot) => slot.node !== 'snare', false)
  for (const outs of all()) {
    assert.ok(outs.every((o) => valueAt(empty, o) === EMPTY_COLOUR))
    assert.equal(valueAt(unrendered, outs[1] ?? out()), EMPTY_COLOUR)
    assert.equal(valueAt(unrendered, outs[0] ?? out()), KIND_COLOURS.drum)
  }
})

test('T5: in Sampler mode PAGE ◀ is lit while a bank before exists, PAGE ▶ while one after does; none written in another mode', () => {
  const leds = (bank: number, showing: boolean) => [views.left, views.right].map((o) => valueAt(planOf(views, 0, banked(SAMPLER_START, bank), () => true, showing), o))
  assert.deepEqual(leds(0, true), [false, true])
  assert.deepEqual(leds(1, true), [true, true])
  assert.deepEqual(leds(3, true), [true, false])
  assert.deepEqual(leds(1, false), [undefined, undefined])
})
