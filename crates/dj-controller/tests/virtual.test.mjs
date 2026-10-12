// Concern: a virtual controller at the package's boundary: each gesture on a control arrives as the device's message for it, outputs read back, gestures it cannot take refused | Non-concern: the twin's pointer and keys (browsers), the core's rows (its own tests) | IO: (gestures, Device) -> assertions
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { Device } from './web-midi.mjs'

const pkg = process.env.DJ_CONTROLLER_PKG
const { initSync } = await import(join(pkg, 'dj_controller.js'))
initSync({ module: readFileSync(join(pkg, 'dj_controller_bg.wasm')) })
const { connect, virtual } = await import(join(pkg, 'index.js'))

/** A virtual FLX10 beside one connected to the stand-in device. */
async function both() {
  const device = new Device().install()
  const real = await connect('DDJ-FLX10')
  const virt = await virtual('DDJ-FLX10')
  const close = () => Promise.all([real.close(), virt.close()])
  return { device, real, virt, hands: virt.virtual, close }
}

const sans = ({ time, released, ...rest }) => rest
// A wait starts listening a turn after its call.
const listening = () => new Promise((resolve) => setImmediate(resolve))

test('a virtual controller has the tree of a connected one, every control where its model file rests it', async () => {
  const { real, virt, close } = await both()
  const shape = (node) => (Array.isArray(node) ? node.map(shape) : Object.getPrototypeOf(node ?? 0) === Object.prototype ? Object.fromEntries(Object.entries(node).filter(([k]) => k !== 'virtual').map(([k, v]) => [k, shape(v)])) : (node?.constructor?.name ?? typeof node))
  assert.deepEqual(shape(virt), shape(real))
  assert.equal(virt.model, 'DDJ-FLX10')
  assert.equal(virt.mixer.channels[0].fader.read().raw, virt.mixer.channels[0].fader.max)
  assert.equal(virt.mixer.crossfader.read().raw, 8192)
  assert.equal(virt.mixer.channels[1].crossfaderAssign.thru.on, true)
  assert.equal(virt.decks[2].inControl.on, false)
  // The same start bank, known on the virtual one, its own device, and assumed on the connected one.
  assert.deepEqual({ ...virt.decks[0].mode }, { ...real.decks[0].mode, pageAssumed: false })
  assert.equal(real.decks[0].mode.pageAssumed, true)
  assert.equal(virt.decks[0].playPause.told, false)
  await close()
})

// 90 0B PLAY, 90 3F SHIFT, 90 47 SHIFT+PLAY (MML p.2 D1, D25).
test('a button pressed and released arrives as the device sends it, on its SHIFT layer while SHIFT is held', async () => {
  const { device, real, virt, hands, close } = await both()
  const play = virt.decks[0].playPause
  const pressed = [virt, real].map((flx) => flx.decks[0].playPause.nextPress())
  await listening()
  hands.press(play)
  device.input.receive('90 0B 7F')
  const [mine, theirs] = await Promise.all(pressed)
  assert.deepEqual(sans(mine), sans(theirs))
  assert.equal(play.pressed, true)
  hands.release(play)
  await mine.released
  assert.equal(play.pressed, false)
  const shifted = [virt, real].map((flx) => flx.decks[0].playPause.nextPress())
  await listening()
  hands.press(virt.decks[0].shift)
  hands.press(play)
  for (const message of ['90 3F 7F', '90 47 7F']) device.input.receive(message)
  const [held, expected] = await Promise.all(shifted)
  assert.deepEqual(sans(held), sans(expected))
  assert.equal(held.shift, true)
  await close()
})

// 97 00: deck 1 pad 1, HOT CUE page 1; 97 30: SAMPLER page 1; 90 22 SAMPLER mode (MML p.6).
test('a pad hit arrives on the pad mode its mode button chose', async () => {
  const { device, real, virt, hands, close } = await both()
  const pad = virt.decks[0].pads[0]
  const hits = [virt, real].map((flx) => flx.decks[0].pads[0].hits())
  const next = async () => Promise.all(hits.map(async (feed) => sans((await feed[Symbol.asyncIterator]().next()).value)))
  hands.hit(pad, 127)
  device.input.receive('97 00 7F')
  let [mine, theirs] = await next()
  assert.deepEqual(mine, theirs)
  hands.lift(pad)
  hands.press(virt.decks[0].padMode.sampler)
  hands.release(virt.decks[0].padMode.sampler)
  hands.hit(pad, 127)
  for (const message of ['97 00 00', '90 22 7F', '90 22 00', '97 30 7F']) device.input.receive(message)
  ;[mine, theirs] = await next()
  assert.deepEqual(mine, theirs)
  assert.equal(mine.mode, 'sampler')
  await close()
})

// B6 1F / B6 3F the crossfader, 0 to 16383 (MML p.2 M1).
test('a fader is read at the positions its reader asks, held through a border, the same on a virtual and a connected controller', async () => {
  const { device, real, virt, hands, close } = await both()
  const faders = [virt, real].map((flx) => flx.mixer.crossfader)
  const hex = (n) => n.toString(16).padStart(2, '0')
  const move = (raw) => {
    hands.move(faders[0], raw)
    for (const message of [`B6 1F ${hex(raw >> 7)}`, `B6 3F ${hex(raw & 0x7f)}`]) device.input.receive(message)
  }
  const each = (read) => faders.map((fader) => read(fader))
  const same = (got, expected, why) => got.forEach((reading) => assert.deepEqual({ ...reading }, expected, why))
  move(8192)
  same(each((f) => f.read()), { position: 500, value: 0.5, raw: 8192 }, 'no positions named: 1001, steps of 0.1 %')
  same(each((f) => f.read({ positions: 11 })), { position: 5, value: 0.5, raw: 8192 })
  same(each((f) => f.read({ positions: 2 })), { position: 1, value: 1, raw: 8192 })
  same(each((f) => f.read({ positions: 'all' })), { position: 8192, value: 8192 / 16383, raw: 8192 })

  const feeds = (options) => each((f) => f.changes(options))
  const next = (streams) => Promise.all(streams.map(async (feed) => (await feed.next()).value))
  // At 11 positions one is 1638.3 raw wide: 9339 is 5.7 positions up, 9502 is 5.8, 8847 is 5.4, 8519 is 5.2.
  const tenths = feeds({ positions: 11 })
  let coming = next(tenths)
  move(9339)
  await listening()
  move(9502)
  same(await coming, { position: 6, value: 0.6, raw: 9502 }, 'position 5 is held until three quarters of the way to 6')
  same(each((f) => f.read({ positions: 11 })), { position: 6, value: 0.6, raw: 9502 })
  coming = next(tenths)
  move(8847)
  await listening()
  same(each((f) => f.read({ positions: 11 })), { position: 5, value: 0.5, raw: 8847 }, 'a read holds nothing')
  move(8519)
  same(await coming, { position: 5, value: 0.5, raw: 8519 }, 'position 6 is held back to a quarter past the border')

  const [switches, fine, all] = [feeds({ positions: 2 }), feeds(), feeds({ positions: 'all' })]
  move(8532)
  same(await next(fine), { position: 521, value: 0.521, raw: 8532 }, 'at the default, 16.4 raw a position, 520 gives way 13 raw up')
  same(await next(all), { position: 8532, value: 8532 / 16383, raw: 8532 }, 'all yields every value')
  move(4000)
  same(await next(switches), { position: 0, value: 0, raw: 4000 })

  for (const fader of faders) {
    for (const positions of [1, 2.5, 16385]) assert.throws(() => fader.changes({ positions }), { name: 'ControllerError', code: 'refused' })
    assert.throws(() => fader.read({ positions: 0 }), { name: 'ControllerError', code: 'refused' })
    assert.throws(() => fader.changes({ positions: '10%' }), TypeError)
  }
  await close()
})

// B0 00 / B0 20 TEMPO (MML p.2 D4); B0 22 the top in vinyl mode (D3); B6 40 browse (B1); 90 18 assign B (M11); 94 20, 94 21 the Beat FX selector (p.3 F13).
test('a fader moved, a jog and an encoder turned and a selector flipped report as the device', async () => {
  const { device, real, virt, hands, close } = await both()
  const value = Math.round(16383 * 0.75)
  hands.move(virt.decks[0].tempo, value)
  assert.equal(virt.decks[0].tempo.read().raw, value)
  for (const message of [`B0 00 ${(value >> 7).toString(16)}`, `B0 20 ${(value & 0x7f).toString(16)}`]) device.input.receive(message)
  assert.equal(real.decks[0].tempo.read().raw, value)

  const platter = virt.decks[0].jog.platter
  const quarter = platter.revolution / 4
  hands.turn(platter, quarter, { layer: 'vinyl-on' })
  assert.equal(platter.position.ticks, quarter)
  for (let left = quarter; left > 0; left -= 63) device.input.receive(`B0 22 ${(0x40 + Math.min(63, left)).toString(16)}`)
  assert.equal(real.decks[0].jog.platter.position.ticks, quarter)
  assert.deepEqual(sans(platter.position.latest), sans(real.decks[0].jog.platter.position.latest))
  assert.equal(platter.position.latest.layer, 'vinyl-on')

  for (const ticks of [1, -1, -1]) hands.turn(virt.browser.rotate, ticks)
  for (const message of ['B6 40 01', 'B6 40 7F', 'B6 40 7F']) device.input.receive(message)
  assert.equal(virt.browser.rotate.position.ticks, -1)
  assert.equal(real.browser.rotate.position.ticks, -1)

  const assign = virt.mixer.channels[0].crossfaderAssign
  hands.flip(assign.b, true)
  assert.deepEqual([assign.a.on, assign.thru.on, assign.b.on], [false, false, true], 'a selector leaves the position it was at')
  device.input.receive('90 18 7F')
  assert.equal(real.mixer.channels[0].crossfaderAssign.b.on, true)

  const select = virt.effect.beatFxSelect
  assert.equal(select.lowCutEcho.on, true)
  hands.flip(select.echo, true)
  assert.deepEqual([select.lowCutEcho.on, select.echo.on], [false, true])
  for (const message of ['94 20 00', '94 21 7F']) device.input.receive(message)
  assert.deepEqual([real.effect.beatFxSelect.lowCutEcho.on, real.effect.beatFxSelect.echo.on], [false, true])
  await close()
})

test('a press naming a layer presses that layer, a shared press names its deck, and DECK SELECT moves its side', async () => {
  const { virt, hands, close } = await both()
  const sync = virt.decks[0].keySync
  const presses = sync.presses()[Symbol.asyncIterator]()
  hands.press(sync)
  assert.equal((await presses.next()).value.layer, '')
  hands.press(sync, { layer: 'long-press' })
  const long = (await presses.next()).value
  assert.equal(long.layer, 'long-press')
  hands.release(sync)
  await long.released

  const browse = virt.browser.press.presses()[Symbol.asyncIterator]()
  hands.press(virt.browser.press, { index: 0 })
  hands.release(virt.browser.press)
  assert.equal((await browse.next()).value.deck, 0)
  hands.press(virt.deckSelect.left)
  hands.release(virt.deckSelect.left)
  assert.deepEqual([virt.decks[0].inControl.on, virt.decks[2].inControl.on], [false, true], 'DECK SELECT moves its side to deck 3')
  await close()
})

test('a virtual controller takes writes and leases as a connected one, and refuses a gesture it cannot take', async () => {
  const { real, virt, close } = await both()
  await virt.decks[0].playPause.led(true)
  assert.equal(virt.decks[0].playPause.told, true)
  await virt.decks[0].modes.sampler.pages[1].pads[2].colour(5)
  assert.equal(virt.decks[0].modes.sampler.pages[1].pads[2].told, 5)
  const lease = await virt.decks[0].cue.play({ steps: [[true, 60000], [false, 60000]], repeat: true })
  assert.equal(virt.decks[0].cue.told, true)
  await lease[Symbol.asyncDispose]()
  const refused = (act) => assert.throws(act, (e) => e.name === 'ControllerError' && e.code === 'refused')
  refused(() => virt.virtual.press(virt.decks[0].shifted.cue))
  refused(() => virt.virtual.press(real.decks[0].cue))
  refused(() => virt.virtual.hit(virt.decks[0].pads[0], 0))
  refused(() => virt.virtual.turn(virt.decks[0].jog.platter, 1, { layer: 'no-such' }))
  refused(() => virt.virtual.flip(virt.mixer.mic.on, false))
  assert.throws(() => virt.virtual.move(virt.decks[0].tempo, 0.5), TypeError)
  assert.deepEqual(virt.virtual.layers(virt.decks[0].keySync), ['', 'long-press'])
  assert.equal(virt.virtual.flips(virt.mixer.mic.on), 'selector')
  assert.equal(virt.virtual.flips(virt.mixer.channels[0].faderStart.leavesZero), undefined, 'a state the unit reports takes no hand')
  const stop = new AbortController()
  const aborted = await virtual('DDJ-FLX10', { signal: stop.signal })
  stop.abort()
  assert.equal(await aborted.closed, 'aborted')
  assert.throws(() => aborted.virtual.press(aborted.decks[0].cue), (e) => e.code === 'closed')
  await close()
  assert.equal(await virt.closed, 'closed')
})
