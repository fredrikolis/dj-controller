// Concern: checks the hot cues spec's T10: slot colours, the called hot loop's blink in phase, SHIFT views equal, page 2 painted while hidden | Non-concern: the driver's leases | IO: none
import assert from 'node:assert/strict'
import test from 'node:test'
import type { Pattern } from 'dj-controller'
import { showLights, type ModeViews, type Output } from '../lights/show-lights.ts'
import { NO_HOT_CUES, type HotCue } from '../transport/hot-cue-state.ts'
import { looping, NO_LOOP } from '../transport/loop-state.ts'
import type { Cueing } from './hot-cue.ts'
import { cueColour, EMPTY_COLOUR, HOT_LOOP_BLINK, LOOP_COLOUR, padLightsOf, planOf } from './lights.ts'

type Call = { readonly name: string; readonly what: 'set' | 'play' | 'ended'; readonly value: unknown }

/** An output recording each write and lease in one shared log; a lease logs its end when its signal aborts. */
function fake<T>(name: string, log: Call[]): Output<T> {
  let base: T | undefined
  return {
    get base() {
      return base
    },
    async set(value) {
      base = value
      log.push({ name, what: 'set', value })
    },
    async play(pattern: Pattern<T>, { signal }) {
      log.push({ name, what: 'play', value: pattern })
      signal.addEventListener('abort', () => log.push({ name, what: 'ended', value: null }), { once: true })
    },
  }
}

function views(log: Call[]): ModeViews {
  const page = (p: number) => ({
    pads: Array.from({ length: 8 }, (_, i) => fake<number>(`${p} ${i}`, log)),
    shifted: Array.from({ length: 8 }, (_, i) => fake<number>(`${p} ${i} shift`, log)),
  })
  return { pages: [page(0), page(1)], left: fake<boolean>('left', log), right: fake<boolean>('right', log) }
}

const deck = (cues: Record<number, HotCue>, loop = NO_LOOP): Pick<Cueing, 'loop' | 'hotCues'> => ({ loop, hotCues: NO_HOT_CUES.map((c, i) => cues[i] ?? c) })
const hotLoop: HotCue = { kind: 'loop', in: 20000, out: 100000 }

test('T10: an empty slot, a cue and a hot loop each show their colour; the called hot loop blinks', () => {
  const lights = padLightsOf(deck({ 0: { kind: 'cue', at: 0 }, 9: hotLoop }, looping(hotLoop)))
  assert.deepEqual(lights.slice(0, 2), [{ colour: cueColour(0), blink: false }, { colour: EMPTY_COLOUR, blink: false }])
  assert.deepEqual(lights[9], { colour: LOOP_COLOUR, blink: true })
  assert.equal(padLightsOf(deck({ 9: hotLoop }, looping({ in: 20000, out: 60000 })))[9]?.blink, false, 'halved, it no longer blinks')
})

test('T10: page 2 is painted while page 1 shows, the SHIFT views equal the plain, one blink lease on each for the called hot loop from the loops\' origin, PAGE ◀ lit', async () => {
  const log: Call[] = []
  const life = new AbortController()
  await showLights(life.signal)(planOf(views(log), padLightsOf(deck({ 0: { kind: 'cue', at: 0 }, 15: hotLoop }, looping(hotLoop))), 0))
  const shown = (name: string) => log.find((c) => c.name === name)
  assert.deepEqual([shown('0 0')?.value, shown('1 6')?.value, shown('1 7')], [cueColour(0), EMPTY_COLOUR, { name: '1 7', what: 'play', value: { ...HOT_LOOP_BLINK, origin: 0 } }])
  for (let p = 0; p < 2; p++) for (let i = 0; i < 8; i++) assert.deepEqual({ ...shown(`${p} ${i} shift`), name: '' }, { ...shown(`${p} ${i}`), name: '' })
  assert.deepEqual(log.filter((c) => c.what === 'play').map((c) => c.name), ['1 7', '1 7 shift'])
  assert.deepEqual([shown('left')?.value, shown('right')?.value], [true, false])
  life.abort()
})

test('setting a slot writes its colour at once; clearing the called hot loop writes 00 under its leases, then ends them', async () => {
  const log: Call[] = []
  const life = new AbortController()
  const out = views(log)
  const show = showLights(life.signal)
  await show(planOf(out, padLightsOf(deck({ 0: hotLoop }, looping(hotLoop))), null))
  log.length = 0
  await show(planOf(out, padLightsOf(deck({ 0: hotLoop, 1: { kind: 'cue', at: 0 } }, looping(hotLoop))), null))
  assert.deepEqual(log, [{ name: '0 1', what: 'set', value: cueColour(1) }, { name: '0 1 shift', what: 'set', value: cueColour(1) }])
  log.length = 0
  await show(planOf(out, padLightsOf(deck({ 1: { kind: 'cue', at: 0 } }, looping(hotLoop))), null))
  const pad = log.filter((c) => c.name.startsWith('0 0'))
  assert.deepEqual(pad.map((c) => `${c.name} ${c.what} ${String(c.value)}`), ['0 0 set 0', '0 0 shift set 0', '0 0 ended null', '0 0 shift ended null'])
  life.abort()
})
