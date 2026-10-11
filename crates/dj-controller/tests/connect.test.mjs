// Concern: the package's public contract at its boundary, against a stand-in Web MIDI: connect's lifecycle, state at connect, typed streams and writes, physical and paged views, rejections, unplug and cancellation | Non-concern: the core's decoding (its own tests), browsers | IO: (Device) -> assertions
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { Device, listened } from './web-midi.mjs'

const pkg = process.env.DJ_CONTROLLER_PKG
const main = join(pkg, 'dj_controller_bg.wasm')
for (const wasm of ['', 'diagnostics']) {
  const { initSync } = await import(join(pkg, wasm, 'dj_controller.js'))
  initSync({ module: readFileSync(join(pkg, wasm, 'dj_controller_bg.wasm')) })
}
const { connect, palette } = await import(join(pkg, 'index.js'))
const diagnostics = await import(join(pkg, 'diagnostics.js'))
const { inspect } = diagnostics

// Addresses from the FLX10's model file (MML pp.2-6): deck 1 pads on ch8, deck 2 on ch10.
const PAD1_HOT_CUE = { deck1: '97 00', deck2: '99 00' }
const PAD1_SAMPLER = '97 30'
const PLAY = { deck1: '90 0B', deck2: '91 0B' }
const PAGE_RIGHT_HOT_CUE = '90 2C'
const PAGE_LEFT_HOT_CUE = '90 24'
const SHIFT = '90 3F'

// Every timer the driver sets and has not cleared or seen fire, so a test can tell none is left.
const timers = new Set()
const [setTimer, clearTimer] = [globalThis.setTimeout, globalThis.clearTimeout]
globalThis.setTimeout = (f, ms, ...args) => {
  const id = setTimer(() => {
    timers.delete(id)
    f(...args)
  }, ms)
  timers.add(id)
  return id
}
globalThis.clearTimeout = (id) => {
  timers.delete(id)
  clearTimer(id)
}

// Steps outlast every test, so no assertion waits on the wall clock; the core times steps on a fake one.
const blink = (a, b) => ({ steps: [[a, 60000], [b, 60000]], repeat: true })

const rejectsWith = (promise, code) => assert.rejects(promise, (e) => e.name === 'ControllerError' && e.code === code)

async function connected(options, entry = connect) {
  const device = new Device().install()
  const flx = await entry('DDJ-FLX10', options)
  return { device, flx }
}

test('connect resolves with the state reply already in, every output told its rest state', async () => {
  const { device, flx } = await connected()
  // The recorded reply's first pair: deck 1 TEMPO, B0 00 43 / B0 20 6D.
  assert.equal(flx.decks[0].tempo.value, (0x43 << 7) | 0x6d)
  assert.equal(flx.decks[0].tempo.max, 16383)
  assert.equal(flx.mixer.channels[0].fader.value, 0)
  assert.ok(device.output.sent.includes(`${PLAY.deck1} 00`))
  assert.equal(device.input.connection, 'open')
  assert.ok(Object.isFrozen(flx) && flx.model === 'DDJ-FLX10' && typeof flx.close === 'function')
  await flx.close()
})

test('two first pads mirror onto two buttons, each lit until its pad is released', async () => {
  const { device, flx } = await connected()
  const stop = new AbortController()
  const mirror = async (pad, button) => {
    try {
      for await (const hit of pad.hits({ signal: stop.signal })) {
        await button.led(true)
        await hit.released
        await button.led(false)
      }
    } catch (e) {
      if (e !== stop.signal.reason) throw e
    }
  }
  const running = Promise.all([mirror(flx.decks[0].pads[0], flx.decks[0].playPause), mirror(flx.decks[1].pads[0], flx.decks[1].playPause)])
  for (const deck of ['deck1', 'deck2']) {
    const lit = device.output.next(`${PLAY[deck]} 7F`)
    device.input.receive(`${PAD1_HOT_CUE[deck]} 7F`)
    await lit
    const unlit = device.output.next(`${PLAY[deck]} 00`)
    device.input.receive(`${PAD1_HOT_CUE[deck]} 00`)
    await unlit
  }
  stop.abort()
  await running
  await flx.close()
})

test('a hit carries its identity, 0-based, and the paged views follow the mode the device reports', async () => {
  const { device, flx } = await connected()
  const deck = flx.decks[0]
  const physical = deck.pads[0].hits()
  const hotCue = deck.modes.hotCue.pages[0].pads[0].hits()
  const sampler = deck.modes.sampler.pages[0].pads[0].hits()
  const modes = deck.modeChanges()

  device.input.receive(`${PAD1_HOT_CUE.deck1} 7F`, 1234.5)
  const hit = (await physical.next()).value
  assert.deepEqual({ ...hit, released: undefined }, { deck: 0, pad: 0, mode: 'hotCue', page: 0, shift: false, velocity: 127, time: 1234.5, released: undefined })
  assert.equal((await hotCue.next()).value.mode, 'hotCue')

  device.input.receive(`${PAD1_SAMPLER} 7F`)
  assert.equal((await physical.next()).value.mode, 'sampler')
  assert.equal((await sampler.next()).value.mode, 'sampler')
  assert.deepEqual({ ...(await modes.next()).value }, { mode: 'sampler', page: 0, shift: false }, 'hot cue was already showing')
  assert.deepEqual({ ...deck.mode }, { mode: 'sampler', page: 0, shift: false })

  const written = device.output.next(`${PAD1_SAMPLER} 05`)
  await deck.pads[0].colour(5)
  await written
  const banked = device.output.next(`${PAD1_HOT_CUE.deck1} 01`)
  await deck.modes.hotCue.pages[0].pads[0].colour(1)
  await banked

  await flx.close()
  assert.equal((await hotCue.next()).done, true, 'the hot cue view saw no sampler hit, then ended')
})

test('a physical pad takes a colour right after connect, on the bank the device starts in', async () => {
  const { device, flx } = await connected()
  assert.deepEqual({ ...flx.decks[0].mode }, { mode: 'hotCue', page: 0, shift: false })
  const written = device.output.next(`${PAD1_HOT_CUE.deck1} 01`)
  await flx.decks[0].pads[0].colour(1)
  await written
  await flx.close()
})

test('a physical pad writes the bank PAGE and shifted mode presses show, SHIFT + PAGE keeps the page, and each bank keeps its colour', async () => {
  const { device, flx } = await connected()
  const [deck] = flx.decks
  const pad = deck.pads[0]
  await pad.colour(1)
  const sent = device.output.sent.length
  // PAGE right in HOT CUE (MML p.6 P14; p.7 *1): page 2 shows, no pad pressed.
  device.input.receive(`${PAGE_RIGHT_HOT_CUE} 7F`)
  assert.deepEqual({ ...deck.mode }, { mode: 'hotCue', page: 1, shift: false })
  assert.equal(pad.told, 0, 'page 2 holds what the connect sync told it')
  const page2 = device.output.next('97 08 05')
  await pad.colour(5)
  await page2
  device.input.receive(`${PAGE_LEFT_HOT_CUE} 7F`)
  assert.equal(pad.told, 1, 'the unit keeps each bank\'s colours (docs/research/flx10-observed-pads.md), so page 1 shows its own again')
  // SAMPLER (90 22, MML p.6 P12) and back to HOT CUE (90 1B, P9): which page HOT CUE returns to is unobserved.
  device.input.receive('90 22 7F')
  device.input.receive('90 1B 7F')
  assert.equal(pad.told, undefined)
  device.input.receive(`${PAGE_LEFT_HOT_CUE} 7F`)
  assert.equal(pad.told, 1)
  assert.equal(device.output.sent.length, sent + 1, 'no bank change repaints a pad')
  // SHIFT + PAGE right in HOT CUE, 90 09 (MML p.6 P14), switches the jog display alone (MAN p.18 item 17).
  for (const message of [`${SHIFT} 7F`, '90 09 7F', `${SHIFT} 00`]) device.input.receive(message)
  assert.deepEqual({ ...deck.mode }, { mode: 'hotCue', page: 0, shift: false })
  // SHIFT + BEAT JUMP (90 6D, MML p.6 P11; MAN p.18 item 15) is Beat Loop; PAGE right in it is 90 32.
  for (const message of [`${SHIFT} 7F`, '90 6D 7F', `${SHIFT} 00`, '90 32 7F']) device.input.receive(message)
  assert.deepEqual({ ...deck.mode }, { mode: 'beatLoop', page: 1, shift: false })
  const beatLoop = device.output.next('97 68 09')
  await pad.colour(9)
  await beatLoop
  await flx.close()
})

test('every PAGE press streams with the mode it was pressed in, also one that leaves the page where it was', async () => {
  const { device, flx } = await connected()
  const [deck] = flx.decks
  const presses = deck.page.right.presses()
  // SAMPLER (90 22, MML p.6 P12), then PAGE right in it twice (90 2F, P14; p.7 *1: PAGE 2).
  device.input.receive('90 22 7F', 1)
  for (const [time, value] of [[2, '7F'], [3, '00'], [4, '7F'], [5, '00']]) device.input.receive(`90 2F ${value}`, time)
  for (const time of [2, 4]) assert.deepEqual({ ...(await presses.next()).value, released: undefined }, { deck: 0, mode: 'sampler', shift: false, time, released: undefined })
  assert.deepEqual({ ...deck.mode }, { mode: 'sampler', page: 1, shift: false })
  await flx.close()
})

test('each output tells what it was last told, from any path, on the bank it shows, and streams each change', async () => {
  const { device, flx } = await connected(undefined, diagnostics.connect)
  const [deck] = flx.decks
  assert.equal(deck.playPause.told, false, 'the connect sync told every LED off')
  assert.equal(deck.pads[0].told, 0)
  assert.equal(deck.padMode.hotCue.told, undefined, 'the firmware drives it, so nothing is claimed')
  const lit = deck.playPause.toldChanges()
  await deck.playPause.led(true)
  assert.equal((await lit.next()).value, true)
  await inspect(flx).send(Uint8Array.from(`${PLAY.deck1} 00`.split(' '), (b) => parseInt(b, 16)))
  assert.equal((await lit.next()).value, false, 'a raw send is told too')

  const colours = deck.pads[0].toldChanges()
  await deck.pads[0].colour(5)
  assert.equal((await colours.next()).value, 5)
  await deck.modes.sampler.pages[0].pads[0].colour(9)
  device.input.receive(`${PAD1_SAMPLER} 7F`)
  assert.equal((await colours.next()).value, 9, 'the sampler bank shows now')
  assert.equal(deck.modes.hotCue.pages[0].pads[0].told, 5)

  assert.equal(flx.palette.colour(1).name, 'blue', 'the model file\'s palette')
  await deck.display.bpm.set(128)
  assert.equal(deck.display.bpm.told, 128, 'as the unit shows it')
  assert.deepEqual(deck.display.bpm.range, [0, 999.9], 'the model file\'s range, as the unit shows it')
  assert.equal(deck.jog.ring.range, undefined, 'only some values')
  assert.equal(deck.display.bpm.labels, undefined, 'no labels where the model file states none')
  const { key, keyChange } = deck.display
  assert.deepEqual([key.labels[0], key.labels[12], key.labels.length], ['---', 'Dm', 25], 'MML p.7 *3')
  await key.set(key.range[0] + key.labels.indexOf('Dm'))
  assert.equal(key.told, 0x0c, 'written raw')
  assert.equal(keyChange.range[0] + keyChange.labels.indexOf('0'), 0x0d, 'MML p.7 Key change amount: 0x0D is 0')
  await flx.close()
  assert.equal((await colours.next()).done, true)
})

test('a model\'s palette reads with no connection, as its controller gives it once connected', async () => {
  const unplugged = await palette('DDJ-FLX10')
  const { flx } = await connected()
  assert.deepEqual(unplugged.colours, flx.palette.colours)
  assert.deepEqual(unplugged.colour(1), flx.palette.colour(1))
  await assert.rejects(palette('DDJ-NONE'), TypeError)
  await flx.close()
})

test('an unread stream keeps the newest 4096 reports and counts the rest; a level keeps only its latest', async () => {
  const { device, flx } = await connected(undefined, diagnostics.connect)
  const turns = inspect(flx).turns(flx.decks[0].jog.platter)
  const tempo = flx.decks[0].tempo.changes()
  // Deck 1 platter, CC 0x22 around 0x40 (MML p.2 D3); TEMPO, B0 00 / B0 20 (MML p.2 D4).
  for (let n = 0; n < 4096 + 5; n++) device.input.receive(`B0 22 ${n % 2 ? '41' : '3F'}`)
  for (const msb of ['10', '20', '30']) for (const message of [`B0 00 ${msb}`, 'B0 20 00']) device.input.receive(message)
  assert.equal(turns.dropped, 5)
  assert.equal((await turns.next()).value.ticks, 1, 'the sixth turn is the oldest kept')
  assert.equal((await tempo.next()).value, 0x30 << 7)
  assert.equal(tempo.dropped, 0)
  await flx.close()
})

test('a slow reader of a jog gets every tick summed exactly, and only the newest position', async () => {
  const { device, flx } = await connected()
  const platter = flx.decks[0].jog.platter
  assert.deepEqual(platter.position, { ticks: 0, latest: undefined })
  const positions = platter.positions()
  // Deck 1 platter, CC 0x22 (vinyl on) around 0x40 (MML p.2 D3).
  let sum = 0
  for (let n = 0; n < 10000; n++) {
    const step = n % 3 ? 3 : -5
    sum += step
    device.input.receive(`B0 22 ${(0x40 + step).toString(16)}`, n)
  }
  const { value } = await positions.next()
  assert.equal(value.ticks, sum)
  assert.deepEqual({ ...value.latest }, { deck: 0, shift: false, layer: 'vinyl-on', time: 9999 })
  assert.equal(positions.dropped, 0)
  assert.equal(platter.position.ticks, sum)
  // No older position waits behind it: the next is the next tick's.
  const next = positions.next()
  device.input.receive('B0 22 3F', 10001)
  assert.equal((await next).value.ticks, sum - 1)
  await flx.close()
})

test('an unread jog position ends at each layer change, so a read never holds a tick from another layer', async () => {
  const { device, flx } = await connected()
  const platter = flx.decks[0].jog.platter
  const positions = platter.positions()
  // Deck 1 platter: B0 22 vinyl on, B0 29 turned with 4 BEAT JUMP held (MML p.2 D3; MAN p.20 item 24).
  for (const [time, message] of [[0, 'B0 22 43'], [1, 'B0 22 42'], [2, 'B0 29 45'], [3, 'B0 29 3F'], [4, 'B0 22 41']]) device.input.receive(message, time)
  const runs = []
  for (let n = 0; n < 3; n++) {
    const { value } = await positions.next()
    runs.push([value.ticks, value.latest.layer, value.latest.time])
  }
  assert.deepEqual(runs, [[5, 'vinyl-on', 1], [9, '4-beat-jump', 3], [10, 'vinyl-on', 4]])
  assert.equal(positions.dropped, 0)
  await flx.close()
})

test('a fader, switch or jog reads its own layer and its shifted view the SHIFT layer, so neither mixes in the other', async () => {
  const { device, flx } = await connected()
  const [deck] = flx.decks
  const leaves = flx.mixer.channels[0].faderStart.leavesZero
  const tempo = deck.tempo.value
  const own = [deck.tempo.changes(), deck.jog.platter.positions(), leaves.changes()]
  const shifted = [deck.shifted.tempo.changes(), deck.shifted.jog.platter.positions(), flx.mixer.channels[0].shifted.faderStart.leavesZero.changes()]
  // SHIFT held: deck 1 TEMPO B0 05 / B0 25, platter B0 1F, channel 1 fader start 90 5D (MML p.2 D4, D3, M1/M2).
  for (const message of [`${SHIFT} 7F`, 'B0 05 10', 'B0 25 00', 'B0 1F 46', '90 5D 7F']) device.input.receive(message, 10)
  assert.equal((await shifted[0].next()).value, 0x10 << 7)
  assert.deepEqual({ ...(await shifted[1].next()).value.latest }, { deck: 0, shift: true, layer: '', time: 10 })
  assert.deepEqual({ ...(await shifted[2].next()).value }, { on: true, time: 10 })
  assert.equal(deck.tempo.value, tempo, 'TEMPO moved with SHIFT held is the shifted view\'s')
  assert.equal(deck.jog.platter.position.ticks, 0)
  assert.equal(deck.shifted.jog.platter.position.ticks, 6)
  assert.equal(leaves.on, undefined)
  // SHIFT let go: TEMPO B0 00 / B0 20, platter vinyl off B0 23, fader start 90 66.
  for (const message of [`${SHIFT} 00`, 'B0 00 20', 'B0 20 00', 'B0 23 3F', '90 66 7F']) device.input.receive(message, 20)
  assert.equal((await own[0].next()).value, 0x20 << 7, 'the control\'s first change is its own layer\'s')
  assert.deepEqual({ ...(await own[1].next()).value }, { ticks: -1, latest: { deck: 0, shift: false, layer: 'vinyl-off', time: 20 } })
  assert.deepEqual({ ...(await own[2].next()).value }, { on: true, time: 20 })
  assert.equal(deck.shifted.tempo.value, 0x10 << 7)
  await flx.close()
})

test('a fader start\'s notes each arrive on their own switch with SHIFT held, a repeated one again with its time', async () => {
  const { device, flx } = await connected()
  const start = flx.mixer.channels[1].faderStart
  const feeds = [start.leavesZero.changes(), flx.mixer.channels[1].shifted.faderStart.leavesZero.changes(), start.reachesZero.changes()]
  // Channel 2 fader start 91 66, 91 5D, 91 52, all sent with SHIFT held (MML p.2 M1/M2; MAN p.91).
  device.input.receive('91 3F 7F', 1)
  for (const [message, time] of [['91 66 7F', 2], ['91 5D 7F', 3], ['91 52 7F', 4], ['91 66 7F', 5], ['91 52 7F', 6]]) device.input.receive(message, time)
  assert.deepEqual({ ...(await feeds[0].next()).value }, { on: true, time: 2 })
  assert.deepEqual({ ...(await feeds[1].next()).value }, { on: true, time: 3 })
  assert.deepEqual({ ...(await feeds[2].next()).value }, { on: true, time: 4 })
  assert.deepEqual({ ...(await feeds[0].next()).value }, { on: true, time: 5 }, 'the same velocity again is a report')
  assert.deepEqual({ ...(await feeds[2].next()).value }, { on: true, time: 6 })
  await flx.close()
})

test('SHIFT + BEAT SYNC and SHIFT + SLIP REVERSE press shifted, light their own SHIFT layer, and the jog screen takes MASTER', async () => {
  const { device, flx } = await connected()
  const [deck] = flx.decks
  const presses = [deck.beatSync.presses(), deck.slipReverse.presses()]
  // Deck 1 BEAT SYNC with SHIFT 90 5C, SLIP REVERSE with SHIFT 90 38 (MML p.2 D6, D20).
  device.input.receive('90 5C 7F', 1)
  device.input.receive('90 38 7F', 2)
  assert.deepEqual({ ...(await presses[0].next()).value, released: undefined }, { deck: 0, shift: true, layer: '', time: 1, released: undefined })
  assert.deepEqual({ ...(await presses[1].next()).value, released: undefined }, { deck: 0, shift: true, time: 2, released: undefined })
  // MASTER (Beat Sync) on deck 1's jog screen 9F 18 (MML p.7).
  for (const [message, write] of [['90 5C 7F', () => deck.shifted.beatSync.led(true)], ['90 38 7F', () => deck.shifted.slipReverse.led(true)], ['9F 18 7F', () => deck.display.beatSync.master.set(127)]]) {
    const sent = device.output.next(message)
    await write()
    await sent
  }
  await flx.close()
})

test('SHIFT + ACTIVE PART is the button\'s SHIFT layer, as every other SHIFT layer: shift on its presses, its LED under shifted', async () => {
  const { device, flx } = await connected()
  const drums = flx.decks[1].activePart.drums
  const presses = drums.presses()
  const shifted = flx.decks[1].shifted.activePart.drums.presses()
  // Deck 2 ACTIVE PART DRUMS 91 0D, with SHIFT held 96 25 (MML p.2 D9).
  device.input.receive('91 0D 7F', 1)
  device.input.receive('96 25 7F', 2)
  assert.deepEqual({ ...(await presses.next()).value, released: undefined }, { deck: 1, shift: false, time: 1, released: undefined })
  assert.deepEqual({ ...(await presses.next()).value, released: undefined }, { deck: 1, shift: true, time: 2, released: undefined })
  assert.equal((await shifted.next()).value.time, 2)
  const lit = device.output.next('96 25 7F')
  await flx.decks[1].shifted.activePart.drums.led(true)
  await lit
  await flx.close()
})

test('a slow reader of a fader gets only its newest value', async () => {
  const { device, flx } = await connected()
  const tempo = flx.decks[0].tempo.changes()
  // Deck 1 TEMPO, B0 00 / B0 20 (MML p.2 D4).
  for (let msb = 0; msb < 100; msb++) for (const message of [`B0 00 ${msb.toString(16)}`, 'B0 20 00']) device.input.receive(message)
  assert.equal((await tempo.next()).value, 99 << 7)
  const next = tempo.next()
  for (const message of ['B0 00 01', 'B0 20 00']) device.input.receive(message)
  assert.equal((await next).value, 1 << 7)
  await flx.close()
})

test('every press arrives in order, each with its release and its time, however slowly they are read', async () => {
  const { device, flx } = await connected()
  const presses = flx.decks[0].playPause.presses()
  for (let n = 0; n < 1000; n++) for (const [velocity, at] of [['7F', 2 * n], ['00', 2 * n + 1]]) device.input.receive(`${PLAY.deck1} ${velocity}`, at)
  let read = 0
  for await (const press of presses) {
    assert.deepEqual({ ...press, released: undefined }, { deck: 0, shift: false, time: 2 * read, released: undefined }, 'each with its own message\'s time')
    assert.equal(await press.released, 2 * read + 1, 'released with its release message\'s time')
    if (++read === 1000) break
  }
  assert.equal(presses.dropped, 0)
  await flx.close()
})

test('a switch reports each position change with its message\'s time', async () => {
  const { device, flx } = await connected()
  const [a, thru] = [flx.mixer.channels[0].crossfaderAssign.a, flx.mixer.channels[0].crossfaderAssign.thru]
  const changes = [a.changes(), thru.changes()]
  // Channel 1 crossfader assign A and THRU, 90 16 and 90 1D (MML p.2 M11).
  device.input.receive('90 16 7F', 500.25)
  device.input.receive('90 1D 00', 500.25)
  assert.deepEqual({ ...(await changes[0].next()).value }, { on: true, time: 500.25 })
  assert.deepEqual({ ...(await changes[1].next()).value }, { on: false, time: 500.25 })
  await flx.close()
})

test('touches read and released leave no listener on the signal once their stream ends', async () => {
  const { device, flx } = await connected()
  const { signal } = new AbortController()
  listened(signal)
  // Deck 1 jog touch, 90 36: 0x7F touched, 0x00 released (MML p.2 D3; docs/research/flx10-observed.md).
  const touches = 500
  const read = (async () => {
    let n = 0
    for await (const press of flx.decks[0].jog.touch.presses({ signal })) {
      await press.released
      if (++n === touches) return
    }
  })()
  for (let n = 0; n < touches; n++) {
    device.input.receive('90 36 7F')
    await new Promise(setImmediate)
    device.input.receive('90 36 00')
    await new Promise(setImmediate)
  }
  await read
  assert.equal(signal.listening('abort'), 0)
  await flx.close()
})

test('a stream that ends takes its listeners off the signal it was given', async () => {
  const { flx } = await connected()
  const { signal } = new AbortController()
  listened(signal)
  const presses = flx.decks[0].playPause.presses({ signal })
  const ended = (async () => {
    for await (const press of presses) void press
  })()
  await flx.close()
  await ended
  assert.equal(signal.listening('abort'), 0)
})

test('writes reject: out of range, a page the device has not told, when the port fails, once closed', async () => {
  const { device, flx } = await connected()
  // SAMPLER, 90 22 (MML p.6 P12): its page is not told until a PAGE or pad press.
  device.input.receive('90 22 7F')
  await rejectsWith(flx.decks[0].pads[0].colour(1), 'unshown')
  await rejectsWith(flx.decks[0].modes.hotCue.pages[0].pads[0].colour(200), 'refused')
  await rejectsWith(flx.decks[0].display.bpm.set(128.05), 'refused')
  const bpm = device.output.next('BF 14 0A BF 34 00')
  await flx.decks[0].display.bpm.set(128)
  await bpm
  device.output.broken = true
  await rejectsWith(flx.decks[0].playPause.led(true), 'send')
  device.output.broken = false
  await flx.close()
  await rejectsWith(flx.decks[0].playPause.led(true), 'closed')
  assert.equal(await flx.closed, 'closed')
})

test('a lease shows its first step once play resolves; the newest shows, a write under it sets the base, and disposing reveals the older then the base', async () => {
  const { device, flx } = await connected()
  const pad = flx.decks[0].pads[0]
  await pad.colour(5)
  const older = await pad.play(blink(1, 2))
  assert.equal(device.output.sent.at(-1), `${PAD1_HOT_CUE.deck1} 01`)
  const newer = await pad.play({ steps: [[9, 60000]], repeat: true })
  assert.equal(device.output.sent.at(-1), `${PAD1_HOT_CUE.deck1} 09`)
  assert.equal(pad.told, 9, 'told is what shows')
  const before = device.output.sent.length
  await pad.colour(7)
  assert.equal(device.output.sent.length, before, 'nothing sent under a lease')
  assert.equal(pad.told, 9)
  await newer[Symbol.asyncDispose]()
  await newer.ended
  assert.equal(device.output.sent.at(-1), `${PAD1_HOT_CUE.deck1} 01`, 'the older lease at its step')
  await newer[Symbol.asyncDispose]()
  assert.equal(device.output.sent.length, before + 1, 'a second dispose does nothing')
  await older[Symbol.asyncDispose]()
  assert.equal(device.output.sent.at(-1), `${PAD1_HOT_CUE.deck1} 07`, 'the base the write set')
  assert.equal(pad.told, 7)
  await new Promise(setImmediate)
  assert.equal(timers.size, 0, 'no lease left a timer')
  await flx.close()
})

test('an output\'s base is what shows once no lease holds it, read and streamed beside told', async () => {
  const { flx } = await connected()
  const pad = flx.decks[0].pads[0]
  assert.equal(pad.base, 0, 'the connect sync told it')
  await pad.colour(5)
  const bases = pad.baseChanges()
  const lease = await pad.play(blink(1, 2))
  assert.deepEqual([pad.told, pad.base], [1, 5], 'a lease steps told, never the base')
  await pad.colour(7)
  assert.deepEqual([pad.told, pad.base], [1, 7])
  assert.equal((await bases.next()).value, 7, 'a write under a lease changes the base, nothing sent')
  await lease[Symbol.asyncDispose]()
  assert.deepEqual([pad.told, pad.base], [7, 7])
  assert.equal(flx.decks[0].padMode.hotCue.base, undefined, 'the firmware drives it, so nothing is claimed')
  await flx.close()
})

test('a repeating pattern with an origin starts at the step it shows had it run since then; one run once with an origin is refused', async () => {
  const { device, flx } = await connected()
  const [deck] = flx.decks
  // Steps of a billion ms (11 days): an origin one step and a second back stays in the second step for the whole run.
  const origin = performance.now() - 1e9 - 1000
  const day11 = (a, b) => ({ steps: [[a, 1e9], [b, 1e9]], repeat: true, origin })
  await deck.playPause.play(day11(true, false))
  assert.equal(device.output.sent.at(-1), `${PLAY.deck1} 00`)
  await deck.pads[0].play(day11(1, 2))
  assert.equal(device.output.sent.at(-1), `${PAD1_HOT_CUE.deck1} 02`, 'a lease started later, in the same phase')
  const before = device.output.sent.length
  await rejectsWith(deck.cue.play({ steps: [[true, 100]], origin: 0 }), 'refused')
  await assert.rejects(deck.cue.play({ ...blink(true, false), origin: '0' }), TypeError)
  assert.equal(device.output.sent.length, before)
  await flx.close()
})

test('a lease ends when its signal aborts or the controller closes, leaving no listener or timer', async () => {
  const { device, flx } = await connected()
  const play = flx.decks[0].playPause
  const stop = new AbortController()
  listened(stop.signal)
  const lease = await play.play(blink(true, false), { signal: stop.signal })
  assert.equal(device.output.sent.at(-1), `${PLAY.deck1} 7F`)
  stop.abort()
  await lease.ended
  assert.equal(device.output.sent.at(-1), `${PLAY.deck1} 00`, 'the base the connect sync told')
  await new Promise(setImmediate)
  assert.equal(stop.signal.listening('abort'), 0)
  await assert.rejects(play.play(blink(true, false), { signal: AbortSignal.abort(new Error('never')) }), /never/)
  const racing = new AbortController()
  const starting = play.play(blink(true, false), { signal: racing.signal })
  racing.abort(new Error('while starting'))
  await assert.rejects(starting, /while starting/)
  assert.equal(device.output.sent.at(-1), `${PLAY.deck1} 00`, 'aborted as it started, so ended at once')

  const life = new AbortController()
  listened(life.signal)
  const leases = await Promise.all([play, flx.decks[1].playPause].map((b) => b.play(blink(true, false), { signal: life.signal })))
  const sent = device.output.sent.length
  await flx.close()
  await Promise.all(leases.map((l) => l.ended))
  assert.equal(device.output.sent.length, sent, 'a close reveals nothing')
  await new Promise(setImmediate)
  assert.equal(life.signal.listening('abort'), 0)
  assert.equal(timers.size, 0)
  await rejectsWith(play.play(blink(true, false)), 'closed')
})

test('a pattern of the wrong shape is a TypeError, a step the output does not take is refused, and nothing is sent', async () => {
  const { device, flx } = await connected()
  const pad = flx.decks[0].pads[0]
  const before = device.output.sent.length
  for (const pattern of [undefined, {}, { steps: 'x' }, { steps: [[1]] }, { steps: [['1', 100]] }, { steps: [[1, 100]], repeat: 1 }]) {
    await assert.rejects(pad.play(pattern), TypeError)
  }
  await assert.rejects(flx.decks[0].playPause.play(blink(1, 0)), TypeError)
  for (const steps of [[], [[1, 0]], [[1, 1.5]], [[200, 100]]]) await rejectsWith(pad.play({ steps }), 'refused')
  assert.equal(device.output.sent.length, before)
  await flx.close()
})

test('a number is written whole and in range or refused, never wrapped or cut; a value of another type is a TypeError', async () => {
  const { device, flx } = await connected()
  const pad = flx.decks[0].pads[0]
  const before = device.output.sent.length
  for (const n of [257, 1.5, -1, 128, NaN, Infinity]) await rejectsWith(pad.colour(n), 'refused')
  await rejectsWith(flx.decks[0].display.bpm.set(-1), 'refused')
  await assert.rejects(pad.colour('5'), TypeError)
  await assert.rejects(flx.decks[0].playPause.led(1), TypeError)
  assert.equal(device.output.sent.length, before, 'nothing reached the port')
  assert.throws(() => flx.palette.colour(1.5), (e) => e.code === 'refused')
  await flx.close()
})

test('unplugging ends every stream, rejects pending waits, settles closed and drops the listeners', async () => {
  const { device, flx } = await connected()
  const presses = flx.decks[0].playPause.presses()
  const next = flx.decks[0].cue.nextPress()
  const ended = (async () => {
    const seen = []
    for await (const press of presses) seen.push(press)
    return seen
  })()
  device.input.receive(`${PLAY.deck1} 7F`)
  device.unplug()
  const [held] = await ended
  assert.ok((await held.released) >= held.time, 'a press held at the close is released then, on the same clock')
  await rejectsWith(next, 'unplugged')
  assert.equal(await flx.closed, 'unplugged')
  assert.equal(device.input.onmidimessage ?? null, null)
  assert.equal(device.access.listening('statechange'), 0)
})

test('a close takes every listener connect added off the MIDI access and off the signal', async () => {
  const { signal } = new AbortController()
  listened(signal)
  const { device, flx } = await connected({ signal })
  assert.equal(signal.listening('abort'), 1)
  await flx.close()
  await flx.closed
  assert.equal(signal.listening('abort'), 0)
  assert.equal(device.access.listening('statechange'), 0)
})

test('connect waits for the device to be plugged in, and again after an unplug', async () => {
  const device = new Device({ plugged: false }).install()
  const connecting = connect('DDJ-FLX10')
  setTimeout(() => device.plug(), 0)
  const flx = await connecting
  device.unplug()
  assert.equal(await flx.closed, 'unplugged')
  const again = connect('DDJ-FLX10')
  setTimeout(() => device.plug(), 0)
  const replugged = await again
  assert.notEqual(replugged, flx)
  assert.ok(replugged.decks[0].tempo.value !== undefined)
  await replugged.close()
})

test('connect rejects typed: permission refused, a port held elsewhere, no state answer', async () => {
  new Device().install({ refuse: true })
  await rejectsWith(connect('DDJ-FLX10'), 'permission')
  const held = new Device().install()
  held.input.held = true
  await rejectsWith(connect('DDJ-FLX10'), 'busy')
  const mute = new Device().install()
  mute.answers = false
  await rejectsWith(connect('DDJ-FLX10'), 'timeout')
  assert.equal(mute.input.connection, 'closed')
})

test('an abort cancels a stream, a wait, a pending connect, and a connected controller', async () => {
  const { device, flx } = await connected()
  const stop = new AbortController()
  const positions = flx.decks[0].jog.platter.positions({ signal: stop.signal })
  const pending = positions.next()
  stop.abort(new Error('done'))
  await assert.rejects(pending, /done/)
  await assert.rejects(flx.decks[0].cue.nextPress({ signal: AbortSignal.abort(new Error('never')) }), /never/)
  await flx.close()

  new Device({ plugged: false }).install()
  const waiting = new AbortController()
  const connecting = connect('DDJ-FLX10', { signal: waiting.signal })
  waiting.abort(new Error('gave up'))
  await assert.rejects(connecting, /gave up/)

  const life = new AbortController()
  const { flx: tied } = await connected({ signal: life.signal })
  life.abort()
  assert.equal(await tied.closed, 'aborted')
  void device
})

test('the diagnostics see every message and telling of a controller their connect resolved to, and only such', async () => {
  const { device, flx } = await connected(undefined, diagnostics.connect)
  const look = inspect(flx)
  const messages = look.messages()
  const told = look.told()
  device.input.receive(`${PLAY.deck1} 7F`)
  const message = (await messages.next()).value
  assert.equal(message.controls[0].control, 'deck1.play-pause')
  await flx.decks[0].playPause.led(true)
  assert.equal((await told.next()).value.via, 'show')
  assert.ok(look.history().some((t) => t.via === 'sync'), 'the connect sync is in the history')
  const turns = look.turns(flx.decks[0].jog.platter)
  // Deck 1 platter, CC 0x22 around 0x40 (MML p.2 D3).
  device.input.receive('B0 22 43')
  assert.deepEqual({ ...(await turns.next()).value }, { deck: 0, shift: false, layer: 'vinyl-on', ticks: 3 })
  await flx.close()
  const { flx: plain } = await connected()
  assert.throws(() => inspect(plain), TypeError)
  assert.equal(plain.decks[0].jog.platter.turns, undefined, 'each report of a jog only the diagnostics give')
  await plain.close()
})

test('the main entry\'s wasm and types carry none of the diagnostics', () => {
  const exports = WebAssembly.Module.exports(new WebAssembly.Module(readFileSync(main))).map((e) => e.name)
  for (const name of ['inspect', 'openScreens', 'controlStep', 'inspector_send', 'inspector_repeat']) assert.ok(!exports.includes(name), name)
  const types = readFileSync(join(pkg, 'dj_controller.d.ts'), 'utf8')
  for (const name of ['Inspector', 'DeckEvent', 'Told =', 'HidReport', 'openScreens', 'Turn<', 'turns(']) assert.ok(!types.includes(name), name)
})
