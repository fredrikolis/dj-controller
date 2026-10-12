// Concern: checks showLights on recording outputs: steady values written, blinks leased from one origin, restarted only when changed, ended with their life | Non-concern: what a feature shows | IO: none
import assert from 'node:assert/strict'
import test from 'node:test'
import type { Pattern } from 'dj-controller'
import { showLights, type Blink, type Output, type Plan } from './show-lights.ts'

type Call = { readonly name: string; readonly what: 'set' | 'play' | 'ended'; readonly value: unknown }

/** An output as the driver's, recording each write and lease in one shared log; a lease logs its end when its signal aborts. */
function recording<T>(name: string, log: Call[]): Output<T> {
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

const PATTERN: Pattern<boolean> = { steps: [[true, 100], [false, 100]], repeat: true }
const blink = (name: string, out: Output<boolean>): Blink => ({ kind: 'led', name, out, pattern: PATTERN })
const said = (log: readonly Call[]) => log.map((c) => `${c.name} ${c.what}`)

test('blinks start together from one origin; the same plan again writes and restarts nothing', async () => {
  const log: Call[] = []
  const life = new AbortController()
  const [a, b, steady] = ['a', 'b', 'steady'].map((name) => recording<boolean>(name, log))
  const plan: Plan = { steady: [{ kind: 'led', out: steady, value: true }], blinks: [blink('a', a), blink('b', b)] }
  const show = showLights(life.signal)
  await show(plan)
  const inPhase = { ...PATTERN, origin: 0 }
  assert.deepEqual(log, [{ name: 'steady', what: 'set', value: true }, { name: 'a', what: 'play', value: inPhase }, { name: 'b', what: 'play', value: inPhase }])
  await show(plan)
  assert.equal(log.length, 3)
  life.abort()
})

test('an output going from a blink to a steady value is written under its lease before the lease ends', async () => {
  const log: Call[] = []
  const life = new AbortController()
  const [a, b] = ['a', 'b'].map((name) => recording<boolean>(name, log))
  const show = showLights(life.signal)
  await show({ steady: [], blinks: [blink('a', a), blink('b', b)] })
  log.length = 0
  await show({ steady: [{ kind: 'led', out: a, value: false }, { kind: 'led', out: b, value: true }], blinks: [] })
  assert.deepEqual(said(log), ['a set', 'b set', 'a ended', 'b ended'])
  life.abort()
})

test('a connection’s end ends its blinks, and the next connection starts them afresh', async () => {
  const log: Call[] = []
  for (let connection = 0; connection < 2; connection++) {
    const life = new AbortController()
    await showLights(life.signal)({ steady: [], blinks: [blink('a', recording<boolean>('a', log))] })
    life.abort()
  }
  assert.deepEqual(said(log), ['a play', 'a ended', 'a play', 'a ended'])
})
