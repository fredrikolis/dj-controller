// Concern: the twin's layouts against the controllers they draw: every physical input of a model's controller has a part, a jog's part turns by its model's revolution, a part moves as SHIFT moves it | Non-concern: drawing, the element (browsers) | IO: (Device, recorded laps) -> assertions
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { Device } from './web-midi.mjs'

const pkg = process.env.DJ_CONTROLLER_PKG
const { initSync } = await import(join(pkg, 'dj_controller.js'))
initSync({ module: readFileSync(join(pkg, 'dj_controller_bg.wasm')) })
const { connect } = await import(join(pkg, 'index.js'))
const { layoutOf, place, placed } = await import(join(pkg, 'twin/layout.js'))
const { follow } = await import(join(pkg, 'twin/follow.js'))

// Bank views and the lifecycle are no physical controls of their own.
const VIEWS = new Set(['modes', 'shifted', 'model', 'palette', 'closed', 'close'])
const STREAMS = ['presses', 'hits', 'changes', 'positions']

/** Every input control of `node`'s tree, by where it sits. */
function inputs(node, at = 'controller') {
  if (typeof node !== 'object' || node === null) return []
  if (Array.isArray(node)) return node.flatMap((item, i) => inputs(item, `${at}[${i}]`))
  if (Object.getPrototypeOf(node) === Object.prototype) {
    return Object.entries(node).flatMap(([name, value]) => (VIEWS.has(name) ? [] : inputs(value, `${at}.${name}`)))
  }
  return STREAMS.some((stream) => typeof node[stream] === 'function') ? [[at, node]] : []
}

test('the FLX10 layout gives every physical input of its controller a part', async () => {
  new Device().install()
  const flx = await connect('DDJ-FLX10')
  const shown = new Set(place(layoutOf(flx)).flatMap((part) => placed(part).map(({ control }) => control)))
  const missing = inputs(flx).filter(([, control]) => !shown.has(control)).map(([at]) => at)
  assert.deepEqual(missing, [])
  await flx.close()
})

// TEMPO's value rises toward the player, down the panel (owner, 2026-10-10, docs/research/flx10-observed-tempo.md); a channel fader's rises up.
test('the FLX10 layout marks each TEMPO fader reversed, rising toward the player, and no channel fader', async () => {
  new Device().install()
  const flx = await connect('DDJ-FLX10')
  const parts = place(layoutOf(flx))
  const showing = (controls) => parts.filter((part) => placed(part).some(({ control }) => controls.includes(control)))
  const tempos = showing(flx.decks.map((deck) => deck.tempo))
  const faders = showing(flx.mixer.channels.map((channel) => channel.fader))
  assert.ok(tempos.length > 0 && faders.length > 0)
  assert.deepEqual(tempos.map((part) => part.reversed), tempos.map(() => true))
  assert.deepEqual(faders.map((part) => part.reversed ?? false), faders.map(() => false))
  await flx.close()
})

// Owner's deck 2 laps: 12,884 and 13,266 ticks (docs/research/flx10-observed-jog.md).
const LAPS = new URL('../../dj-controller-core/fixtures/ddj-flx10-jog-laps-2026-10-10.hex', import.meta.url)
const LINES = readFileSync(LAPS, 'utf8').split('\n')
const SLOW_LAP = LINES.slice(0, LINES.indexOf('91 36 00'))

test("the FLX10 twin turns deck 2's platter one revolution, within the owner's laps, for the slow lap's 12,884 ticks", async () => {
  // follow reads once an animation frame; Node has none.
  globalThis.requestAnimationFrame ??= (run) => setTimeout(run, 0)
  globalThis.cancelAnimationFrame ??= (id) => clearTimeout(id)
  const device = new Device().install()
  const flx = await connect('DDJ-FLX10')
  const platter = flx.decks[1].jog.platter
  const part = place(layoutOf(flx)).find((p) => placed(p).some(({ control }) => control === platter))
  const at = placed(part).findIndex(({ control }) => control === platter)
  const stop = new AbortController()
  let turns
  const following = follow(part, at, stop.signal, { set: (patch) => ('turns' in patch ? (turns = patch.turns) : undefined), flash() {} }).catch((err) => {
    if (!stop.signal.aborted) throw err
  })
  for (const line of SLOW_LAP) device.input.receive(line)
  assert.equal(typeof platter.revolution, 'number')
  const drawn = () => turns !== undefined && platter.position.ticks === 12884 && Math.abs(turns - 12884 / platter.revolution) < 1e-9
  for (let reads = 0; !drawn() && reads < 1000; reads++) await new Promise((resolve) => setTimeout(resolve, 0))
  assert.ok(turns >= 12884 / 13266 && turns <= 12884 / 12884, `turned ${turns}`)
  stop.abort()
  await following
  await flx.close()
})

test('the FLX10 twin draws TEMPO and the platter where they moved with SHIFT held, as their shifted views report', async () => {
  globalThis.requestAnimationFrame ??= (run) => setTimeout(run, 0)
  globalThis.cancelAnimationFrame ??= (id) => clearTimeout(id)
  const device = new Device().install()
  const flx = await connect('DDJ-FLX10')
  const parts = place(layoutOf(flx))
  const partOf = (control) => parts.find((p) => placed(p).some((c) => c.control === control))
  const stop = new AbortController()
  const drawn = {}
  const following = ['tempo', 'platter'].map((name) => {
    const control = name === 'tempo' ? flx.decks[0].tempo : flx.decks[0].jog.platter
    const part = partOf(control)
    const at = placed(part).findIndex((c) => c.control === control)
    return follow(part, at, stop.signal, { set: (patch) => Object.assign((drawn[name] ??= {}), patch), flash() {} }).catch((err) => {
      if (!stop.signal.aborted) throw err
    })
  })
  // SHIFT held: deck 1 TEMPO B0 05 / B0 25, platter B0 1F (MML p.2 D4, D3).
  for (const message of ['90 3F 7F', 'B0 05 10', 'B0 25 00', 'B0 1F 46']) device.input.receive(message)
  const moved = () => drawn.tempo?.fraction === (0x10 << 7) / flx.decks[0].tempo.max && drawn.platter?.ticks === 6
  for (let reads = 0; !moved() && reads < 1000; reads++) await new Promise((resolve) => setTimeout(resolve, 0))
  assert.ok(moved(), JSON.stringify(drawn))
  stop.abort()
  await Promise.all(following)
  await flx.close()
})
