// Concern: checks the loops spec's T13: loop state as lights, shown as writes and blink leases from one origin, restarted only when blinks change | Non-concern: the driver's leases | IO: none
import assert from 'node:assert/strict'
import test from 'node:test'
import type { Pattern } from 'dj-controller'
import { showLights, type Output } from '../../shared/lights/show-lights.ts'
import type { Grid } from '../../shared/transport/grid.ts'
import { NO_LOOP } from '../../shared/transport/loop-state.ts'
import { BLINK, lightsOf } from './lights.ts'
import { press4BeatExit, type Looping } from './loop.ts'

const grid: Grid = { first: 0, beat: 20000, end: 32 * 20000 }
const idle: Looping = { loaded: true, playing: true, cue: 0, quantize: true, loop: NO_LOOP }
const looping = press4BeatExit(idle, 20000, grid).deck
const stored = press4BeatExit(looping, 30000, grid).deck

test('idle with a song: IN, OUT and QUANTIZE lit, EXIT and RELOOP dark', () => {
  assert.deepEqual(lightsOf(idle, grid), { quantize: true, loopIn: 'on', loopOut: 'on', exit: false, reloop: false, beats: null })
})

test('a loop blinks IN and OUT and lights EXIT, RELOOP dark, its pad’s length blinking; stored and inactive lights RELOOP', () => {
  assert.deepEqual(lightsOf(looping, grid), { quantize: true, loopIn: 'blink', loopOut: 'blink', exit: true, reloop: false, beats: 4 })
  assert.deepEqual(lightsOf(stored, grid), { quantize: true, loopIn: 'on', loopOut: 'on', exit: false, reloop: true, beats: null })
  assert.equal(lightsOf({ ...looping, loop: { ...looping.loop, adjust: 'out' } }, grid).loopOut, 'fast')
})

type Call = { readonly name: string; readonly what: 'set' | 'play' | 'ended'; readonly value: unknown }

/** An output recording each write and lease in one shared log; a lease logs its end when its signal aborts. */
function fake(name: string, log: Call[]): Output<boolean> {
  let base: boolean | undefined
  return {
    get base() {
      return base
    },
    async set(on) {
      base = on
      log.push({ name, what: 'set', value: on })
    },
    async play(pattern: Pattern<boolean>, { signal }) {
      log.push({ name, what: 'play', value: pattern })
      signal.addEventListener('abort', () => log.push({ name, what: 'ended', value: null }), { once: true })
    },
  }
}

test('IN and OUT blink as leases started together; an unchanged plan restarts nothing; a steady value is written before the old leases end', async () => {
  const log: Call[] = []
  const life = new AbortController()
  const [loopIn, loopOut, exit] = ['in', 'out', 'exit'].map((n) => fake(n, log))
  const show = showLights(life.signal)
  const blinking = { steady: [{ kind: 'led' as const, out: exit, value: true }], blinks: ['in', 'out'].map((name, i) => ({ kind: 'led' as const, name, out: [loopIn, loopOut][i] ?? exit, pattern: BLINK })) }
  await show(blinking)
  const inPhase = { ...BLINK, origin: 0 }
  assert.deepEqual(log, [{ name: 'exit', what: 'set', value: true }, { name: 'in', what: 'play', value: inPhase }, { name: 'out', what: 'play', value: inPhase }], 'both from the shared origin')
  await show(blinking)
  assert.equal(log.length, 3, 'nothing restarted or rewritten')
  await show({ steady: [loopIn, loopOut, exit].map((out, i) => ({ kind: 'led' as const, out, value: i < 2 })), blinks: [] })
  assert.deepEqual(
    log.slice(3).map((c) => `${c.name} ${c.what}`),
    ['in set', 'out set', 'exit set', 'in ended', 'out ended'],
  )
  life.abort()
})

test('a new connection’s lights start their blinks afresh, and its end ends them', async () => {
  const log: Call[] = []
  for (let connection = 0; connection < 2; connection++) {
    const life = new AbortController()
    await showLights(life.signal)({ steady: [], blinks: [{ kind: 'led', name: 'in', out: fake('in', log), pattern: BLINK }] })
    life.abort()
  }
  assert.deepEqual(
    log.map((c) => c.what),
    ['play', 'ended', 'play', 'ended'],
  )
})
