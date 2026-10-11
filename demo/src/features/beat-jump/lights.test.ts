// Concern: checks the beat jump spec's T8: both pages' pads and their SHIFT layer in rekordbox's colours, PAGE LEDs only for the page showing | Non-concern: the driver's writes | IO: none
import assert from 'node:assert/strict'
import test from 'node:test'
import type { ModeViews, Output, Steady } from '../../shared/lights/show-lights.ts'
import { planOf } from './lights.ts'

const out = <T>(): Output<T> => ({ base: undefined, set: async () => {}, play: async () => {} })

const page = () => ({ pads: Array.from({ length: 8 }, () => out<number>()), shifted: Array.from({ length: 8 }, () => out<number>()) })
const views: ModeViews = { pages: [page(), page()], left: out<boolean>(), right: out<boolean>() }

const valueAt = (steady: readonly Steady[], o: Output<number> | Output<boolean>) => steady.find((s) => s.out === o)?.value

test('T8: every pad on both pages, plain and SHIFT, steady in its captured colour; no blinks', () => {
  const { steady, blinks } = planOf(views, null)
  const colours = [0x6a, 0x6a, 0x65, 0x65, 0x65, 0x65, 0x6a, 0x6a]
  for (const { pads, shifted } of views.pages) {
    assert.deepEqual(pads.map((p) => valueAt(steady, p)), colours)
    assert.deepEqual(shifted.map((p) => valueAt(steady, p)), colours)
  }
  assert.equal(blinks.length, 0)
})

test('T8: PAGE ◀ lit on page 1 and PAGE ▶ on page 2 in Beat Jump mode, neither written in another mode', () => {
  const pageLeds = (p: number | null) => [valueAt(planOf(views, p).steady, views.left), valueAt(planOf(views, p).steady, views.right)]
  assert.deepEqual(pageLeds(0), [true, false])
  assert.deepEqual(pageLeds(1), [false, true])
  assert.deepEqual(pageLeds(null), [undefined, undefined])
})
