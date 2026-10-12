// Concern: checks padPlan: PAGE LEDs only while the mode shows, every page's pads while hidden, SHIFT's pads as the plain ones, a changed pattern played | Non-concern: a feature's colours | IO: none
import assert from 'node:assert/strict'
import test from 'node:test'
import type { Pattern } from 'dj-controller'
import { padPlan, type PadLight } from './pad-lights.ts'
import { showLights, type ModeViews, type Output } from './show-lights.ts'

const out = <T>(): Output<T> => ({ base: undefined, set: async () => {}, play: async () => {} })
const pads = (): Output<number>[] => Array.from({ length: 8 }, () => out<number>())
const views = (): ModeViews => ({ pages: [0, 1].map(() => ({ pads: pads(), shifted: pads() })), left: out(), right: out() })

// A number per page and pad that is no feature's colour: only where it lands is read.
const numbered = (page: number, pad: number): PadLight => 10 * page + pad

test('PAGE LEDs are told only while the mode shows; every page’s pads are told either way', () => {
  const mode = views()
  const hidden = padPlan([{ views: mode, light: numbered, leds: null }])
  assert.deepEqual(hidden.steady.filter((s) => s.kind === 'led'), [])
  const showing = padPlan([{ views: mode, light: numbered, leds: { left: true, right: false } }])
  assert.deepEqual(showing.steady.filter((s) => s.kind === 'led'), [{ kind: 'led', out: mode.left, value: true }, { kind: 'led', out: mode.right, value: false }])
  const told = (page: number) => mode.pages[page].pads.map((pad) => hidden.steady.find((s) => s.out === pad)?.value)
  assert.deepEqual([told(0), told(1)], [[0, 1, 2, 3, 4, 5, 6, 7], [10, 11, 12, 13, 14, 15, 16, 17]])
  assert.deepEqual(showing.steady.filter((s) => s.kind === 'pad'), hidden.steady)
})

const PATTERN: Pattern<number> = { steps: [[1, 100], [2, 100]], repeat: true }

test('a SHIFT pad shows what its plain pad shows, a colour held or a pattern played', () => {
  const mode = views()
  const plan = padPlan([{ views: mode, light: (page, pad) => (page === 1 && pad === 3 ? PATTERN : numbered(page, pad)), leds: null }])
  const shown = (pad: Output<number>) => plan.steady.find((s) => s.out === pad)?.value ?? plan.blinks.find((b) => b.out === pad)?.pattern
  for (const page of mode.pages) assert.deepEqual(page.shifted.map(shown), page.pads.map(shown))
  assert.deepEqual(plan.blinks.map((b) => b.out), [mode.pages[1].pads[3], mode.pages[1].shifted[3]])
})

test('a pad whose pattern changes plays the new one; the same plan shown again restarts nothing', async () => {
  const played: Pattern<number>[] = []
  const pad: Output<number> = { base: undefined, set: async () => {}, play: async (pattern) => void played.push(pattern) }
  const one: ModeViews = { pages: [{ pads: [pad], shifted: [] }], left: out(), right: out() }
  const other: Pattern<number> = { steps: [[3, 100], [2, 100]], repeat: true }
  const life = new AbortController()
  const show = showLights(life.signal)
  for (const pattern of [PATTERN, PATTERN, other]) await show(padPlan([{ views: one, light: () => pattern, leds: null }]))
  assert.deepEqual(played.map((p) => p.steps), [PATTERN.steps, other.steps])
  life.abort()
})
