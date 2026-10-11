// Concern: checks the PAD FX spec's T6: each slot's colour on both banks' pages and SHIFT layers, the whitest while on, PAGE LEDs in a PAD FX mode | Non-concern: the driver's writes | IO: none
import assert from 'node:assert/strict'
import test from 'node:test'
import type { ModeViews, Output, Steady } from '../../shared/lights/show-lights.ts'
import { slotAt, slotOf } from './banks.ts'
import { NOTHING_HELD, pressed } from './hold.ts'
import { EFFECT_COLOURS, ON_COLOUR, planOf } from './lights.ts'

const out = <T>(): Output<T> => ({ base: undefined, set: async () => {}, play: async () => {} })
const page = () => ({ pads: Array.from({ length: 8 }, () => out<number>()), shifted: Array.from({ length: 8 }, () => out<number>()) })
const bank = (): ModeViews => ({ pages: [page(), page()], left: out<boolean>(), right: out<boolean>() })
const banks = [bank(), bank()]

const valueAt = (steady: readonly Steady[], o: Output<number> | Output<boolean>) => steady.find((s) => s.out === o)?.value

test('T6: every pad of both banks, both pages, plain and SHIFT, in its effect colour; a held one the whitest on both layers', () => {
  const holding = pressed(NOTHING_HELD, 1, slotAt(1, 1, 2))
  const { steady, blinks } = planOf(banks, holding, null)
  banks.forEach((views, b) =>
    views.pages.forEach(({ pads, shifted }, p) => {
      const expected = pads.map((_, pad) => (b === 1 && p === 1 && pad === 2 ? ON_COLOUR : EFFECT_COLOURS[slotOf(slotAt(b, p, pad)).effect]))
      assert.deepEqual(pads.map((o) => valueAt(steady, o)), expected)
      assert.deepEqual(shifted.map((o) => valueAt(steady, o)), expected)
    }),
  )
  assert.equal(blinks.length, 0)
})

test('T6: the PAGE LEDs of the bank showing lit for its page, none written in another mode', () => {
  const leds = (shown: { bank: number; page: number } | null) => banks.flatMap((views) => [views.left, views.right].map((o) => valueAt(planOf(banks, NOTHING_HELD, shown).steady, o)))
  assert.deepEqual(leds({ bank: 0, page: 1 }), [false, true, undefined, undefined])
  assert.deepEqual(leds({ bank: 1, page: 0 }), [undefined, undefined, true, false])
  assert.deepEqual(leds(null), [undefined, undefined, undefined, undefined])
  assert.throws(() => planOf(banks, NOTHING_HELD, { bank: 2, page: 0 }), RangeError)
})
