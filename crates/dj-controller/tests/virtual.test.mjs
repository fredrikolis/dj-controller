// Concern: a virtual controller at the package's boundary: each control kind played through the twin's hands arrives as from a device, outputs read back, gestures it cannot take refused; a host's labels and display text | Non-concern: the element's DOM (browsers), the core's rows (its own tests) | IO: (hands, Device) -> assertions
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { Device } from './web-midi.mjs'

const pkg = process.env.DJ_CONTROLLER_PKG
const { initSync } = await import(join(pkg, 'dj_controller.js'))
initSync({ module: readFileSync(join(pkg, 'dj_controller_bg.wasm')) })
const { connect, virtual } = await import(join(pkg, 'index.js'))
const { layoutOf, place, placed } = await import(join(pkg, 'twin/layout.js'))
const { hands, LONG_PRESS_MS } = await import(join(pkg, 'twin/gestures.js'))
const { tree, showing, shownOf } = await import(join(pkg, 'twin/tree.js'))
const { fit, checked } = await import(join(pkg, 'twin/labels.js'))
const { checkedText } = await import(join(pkg, 'twin/displays.js'))

/** A virtual FLX10 beside one connected to the stand-in device, and the twin's hands on the virtual one's parts. */
async function both() {
  const device = new Device().install()
  const real = await connect('DDJ-FLX10')
  const virt = await virtual('DDJ-FLX10')
  const parts = place(layoutOf(virt))
  const timers = []
  const on = (control) => {
    const part = parts.find((p) => p.shape !== 'display' && placed(p).some((c) => c.control === control))
    const at = placed(part).findIndex((c) => c.control === control)
    const reach = { unit: virt.virtual, shown: () => at, shift: () => virt.decks[0].shift, shifted: () => virt.decks[0].mode.shift, later: (ms, run) => (timers.push({ ms, run }), () => timers.pop()) }
    return { part, hands: hands(part, reach) }
  }
  const close = () => Promise.all([real.close(), virt.close()])
  return { device, real, virt, on, timers, close }
}

const sans = ({ time, released, ...rest }) => rest
// A wait starts listening a turn after its call.
const listening = () => new Promise((resolve) => setImmediate(resolve))

test('a virtual controller has the tree of a connected one, every control where its model file rests it', async () => {
  const { real, virt, close } = await both()
  const shape = (node) => (Array.isArray(node) ? node.map(shape) : Object.getPrototypeOf(node ?? 0) === Object.prototype ? Object.fromEntries(Object.entries(node).filter(([k]) => k !== 'virtual').map(([k, v]) => [k, shape(v)])) : (node?.constructor?.name ?? typeof node))
  assert.deepEqual(shape(virt), shape(real))
  assert.equal(virt.model, 'DDJ-FLX10')
  assert.equal(virt.mixer.channels[0].fader.value, virt.mixer.channels[0].fader.max)
  assert.equal(virt.mixer.crossfader.value, 8192)
  assert.equal(virt.mixer.channels[1].crossfaderAssign.thru.on, true)
  assert.equal(virt.decks[2].inControl.on, false)
  // The same start bank, known on the virtual one, its own device, and assumed on the connected one.
  assert.deepEqual({ ...virt.decks[0].mode }, { ...real.decks[0].mode, pageAssumed: false })
  assert.equal(real.decks[0].mode.pageAssumed, true)
  assert.equal(virt.decks[0].playPause.told, false)
  await close()
})

// 90 0B PLAY, 90 3F SHIFT, 90 47 SHIFT+PLAY (MML p.2 D1, D25).
test('a button held on the twin presses and releases as the device, on its SHIFT layer with the keyboard Shift', async () => {
  const { device, real, virt, on, close } = await both()
  const play = on(virt.decks[0].playPause).hands
  const pressed = [virt, real].map((flx) => flx.decks[0].playPause.nextPress())
  await listening()
  play.down({ x: 0, y: 0 }, false)
  device.input.receive('90 0B 7F')
  const [mine, theirs] = await Promise.all(pressed)
  assert.deepEqual(sans(mine), sans(theirs))
  assert.equal(virt.decks[0].playPause.pressed, true)
  play.up()
  await mine.released
  assert.equal(virt.decks[0].playPause.pressed, false)
  const shifted = [virt, real].map((flx) => flx.decks[0].playPause.nextPress())
  await listening()
  play.key('Enter', true, true)
  assert.equal(virt.decks[0].mode.shift, true)
  for (const message of ['90 3F 7F', '90 47 7F']) device.input.receive(message)
  const [held, expected] = await Promise.all(shifted)
  assert.deepEqual(sans(held), sans(expected))
  assert.equal(held.shift, true)
  play.key('Enter', false, true)
  assert.equal(virt.decks[0].mode.shift, false, 'the borrowed SHIFT is given back')
  await close()
})

// 97 00: deck 1 pad 1, HOT CUE page 1; 97 30: SAMPLER page 1; 90 22 SAMPLER mode (MML p.6).
test('a pad hit on the twin arrives on the pad mode its mode button chose, a latched SHIFT held between clicks', async () => {
  const { device, real, virt, on, close } = await both()
  const pad = on(virt.decks[0].pads[0]).hands
  const hits = [virt, real].map((flx) => flx.decks[0].pads[0].hits())
  const next = async () => Promise.all(hits.map(async (feed) => sans((await feed[Symbol.asyncIterator]().next()).value)))
  pad.down({ x: 0, y: 0 }, false)
  device.input.receive('97 00 7F')
  let [mine, theirs] = await next()
  assert.deepEqual(mine, theirs)
  pad.up()
  const mode = on(virt.decks[0].padMode.sampler).hands
  mode.down({ x: 0, y: 0 }, false)
  mode.up()
  pad.down({ x: 0, y: 0 }, false)
  for (const message of ['97 00 00', '90 22 7F', '90 22 00', '97 30 7F']) device.input.receive(message)
  ;[mine, theirs] = await next()
  assert.deepEqual(mine, theirs)
  assert.equal(mine.mode, 'sampler')
  pad.up()
  const shift = on(virt.decks[0].shift).hands
  shift.down({ x: 0, y: 0 }, false)
  shift.up()
  assert.equal(virt.decks[0].shift.pressed, true, 'SHIFT stays down after its click')
  shift.down({ x: 0, y: 0 }, false)
  assert.equal(virt.decks[0].shift.pressed, false)
  await close()
})

// B0 00 / B0 20 TEMPO (MML p.2 D4); B0 22 the top in vinyl mode (D3); B6 40 browse (B1); 90 18 assign B (M11).
test('a fader, knob, jog, encoder and selector moved on the twin report as the device', async () => {
  const { device, real, virt, on, close } = await both()
  const tempo = on(virt.decks[0].tempo)
  // TEMPO rises toward the player: three quarters down its slot is three quarters of its range.
  tempo.hands.down({ x: tempo.part.x, y: tempo.part.y + tempo.part.size[1] / 4 }, false)
  tempo.hands.up()
  assert.equal(virt.decks[0].tempo.value, Math.round(16383 * 0.75))
  const value = virt.decks[0].tempo.value
  for (const message of [`B0 00 ${(value >> 7).toString(16)}`, `B0 20 ${(value & 0x7f).toString(16)}`]) device.input.receive(message)
  assert.equal(real.decks[0].tempo.value, value)

  const hi = on(virt.mixer.channels[0].eq.hi)
  hi.hands.down({ x: 0, y: 0 }, false)
  hi.hands.move({ x: 0, y: -1 })
  assert.ok(virt.mixer.channels[0].eq.hi.value > 8192, 'a drag up turns it up')
  hi.hands.move({ x: 0, y: -100000 })
  hi.hands.up()
  assert.equal(virt.mixer.channels[0].eq.hi.value, 16383, 'to its end, no further')
  hi.hands.reset()
  assert.equal(virt.mixer.channels[0].eq.hi.value, 8192)
  hi.hands.key('ArrowDown', true, false)
  assert.ok(virt.mixer.channels[0].eq.hi.value < 8192, 'an arrow key steps it')

  const top = on(virt.decks[0].jog.platter)
  const { x, y } = top.part
  const r = top.part.size / 2
  top.hands.down({ x, y: y - r }, false)
  assert.equal(virt.decks[0].jog.touch.pressed, true, 'a hand on the top touches it')
  top.hands.move({ x: x + r, y })
  top.hands.up()
  assert.equal(virt.decks[0].jog.touch.pressed, false)
  const quarter = virt.decks[0].jog.platter.revolution / 4
  assert.equal(virt.decks[0].jog.platter.position.ticks, quarter)
  for (let left = quarter; left > 0; left -= 63) device.input.receive(`B0 22 ${(0x40 + Math.min(63, left)).toString(16)}`)
  assert.equal(real.decks[0].jog.platter.position.ticks, quarter)
  assert.deepEqual(sans(virt.decks[0].jog.platter.position.latest), sans(real.decks[0].jog.platter.position.latest))
  assert.equal(virt.decks[0].jog.platter.position.latest.layer, 'vinyl-on')

  const browse = on(virt.browser.rotate).hands
  browse.wheel(1)
  browse.key('ArrowDown', true, false)
  browse.key('ArrowDown', true, false)
  for (const message of ['B6 40 01', 'B6 40 7F', 'B6 40 7F']) device.input.receive(message)
  assert.equal(virt.browser.rotate.position.ticks, -1)
  assert.equal(real.browser.rotate.position.ticks, -1)

  const assign = virt.mixer.channels[0].crossfaderAssign
  on(assign.b).hands.down({ x: 0, y: 0 }, false)
  assert.deepEqual([assign.a.on, assign.thru.on, assign.b.on], [false, false, true])
  device.input.receive('90 18 7F')
  assert.equal(real.mixer.channels[0].crossfaderAssign.b.on, true)
  assert.equal(on(virt.mixer.channels[0].faderStart.leavesZero).hands, undefined, 'a state the unit reports takes no hand')
  await close()
})

test('a hold past the long press presses that layer too, a shared press names the deck in control', async () => {
  const { virt, on, timers, close } = await both()
  const sync = on(virt.decks[0].keySync).hands
  const presses = virt.decks[0].keySync.presses()[Symbol.asyncIterator]()
  sync.down({ x: 0, y: 0 }, false)
  assert.equal((await presses.next()).value.layer, '')
  assert.deepEqual(timers.map((t) => t.ms), [LONG_PRESS_MS])
  timers[0].run()
  const long = (await presses.next()).value
  assert.equal(long.layer, 'long-press')
  sync.up()
  await long.released

  const browse = virt.browser.press.presses()[Symbol.asyncIterator]()
  const press = on(virt.browser.press).hands
  press.down({ x: 0, y: 0 }, false)
  press.up()
  assert.equal((await browse.next()).value.deck, 0)
  const select = on(virt.deckSelect.left).hands
  select.down({ x: 0, y: 0 }, false)
  select.up()
  assert.deepEqual([virt.decks[0].inControl.on, virt.decks[2].inControl.on], [false, true], 'DECK SELECT moves its side to deck 3')
  await close()
})

// 94 21 ECHO's position, 94 20 LOW CUT ECHO's (MML p.3 F13).
test('a selector knob dragged toward a position turns there, the wheel and arrow keys step it to its ends, as the device reports', async () => {
  const { device, real, virt, close } = await both()
  const parts = place(layoutOf(virt))
  const knob = parts.find((p) => p.shape === 'selector' && p.positions.some((position) => position.on === virt.effect.beatFxSelect.echo))
  const reach = { unit: virt.virtual, shown: () => 0, shift: () => undefined, shifted: () => false, later: () => () => {} }
  const turn = hands(knob, reach)
  const select = virt.effect.beatFxSelect
  const dot = parts.find((p) => p.shape === 'position' && placed(p).some((c) => c.control === select.echo))
  assert.equal(select.lowCutEcho.on, true)
  turn.down({ x: knob.x, y: knob.y }, false)
  turn.move({ x: knob.x + (dot.x - knob.x) * 3, y: knob.y + (dot.y - knob.y) * 3 })
  turn.up()
  assert.deepEqual([select.lowCutEcho.on, select.echo.on], [false, true])
  for (const message of ['94 20 00', '94 21 7F']) device.input.receive(message)
  assert.deepEqual([real.effect.beatFxSelect.lowCutEcho.on, real.effect.beatFxSelect.echo.on], [false, true])
  turn.wheel(1)
  assert.equal(select.mtDelay.on, true)
  for (let i = 0; i < 20; i++) turn.key('ArrowDown', true, false)
  assert.equal(select.lowCutEcho.on, true, 'it stops at its first position')
  for (let i = 0; i < 20; i++) turn.key('ArrowUp', true, false)
  assert.equal(select.mobiusTri.on, true, 'and at its last')
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
  const stop = new AbortController()
  const aborted = await virtual('DDJ-FLX10', { signal: stop.signal })
  stop.abort()
  assert.equal(await aborted.closed, 'aborted')
  assert.throws(() => aborted.virtual.press(aborted.decks[0].cue), (e) => e.code === 'closed')
  await close()
  assert.equal(await virt.closed, 'closed')
})

test("a label's bank is the view it names, the unshifted bank showing for a control, SHIFT's while held", async () => {
  const { virt, close } = await both()
  const { seats, owners } = tree(virt)
  const deck = virt.decks[0]
  const seat = seats.get(deck.pads[2])
  assert.equal(seats.get(deck.modes.sampler.pages[1].shifted.pads[2]), seat, 'a view sits at its control')
  const now = (shift) => showing(seat, shownOf(seat, owners), shift)
  assert.equal(now(false), deck.modes.hotCue.pages[0].pads[2])
  assert.equal(now(true), deck.modes.hotCue.pages[0].shifted.pads[2])
  virt.virtual.press(deck.padMode.sampler)
  assert.equal(now(false), deck.modes.sampler.pages[0].pads[2], 'a mode never seen comes up on its page 1')
  assert.equal(deck.mode.pageAssumed, false, 'a virtual controller is its own device: it assumes no page')
  virt.virtual.press(deck.page.right)
  assert.equal(now(false), deck.modes.sampler.pages[1].pads[2])
  const cue = seats.get(deck.cue)
  assert.equal(showing(cue, shownOf(cue, owners), false), deck.cue)
  assert.equal(showing(cue, shownOf(cue, owners), true), deck.shifted.cue)
  const back = seats.get(virt.browser.back)
  virt.virtual.press(virt.decks[1].shift)
  assert.equal(shownOf(back, owners).shift, true, 'a control with no SHIFT of its own counts any held')
  assert.equal(showing(back, shownOf(back, owners), true), virt.shifted.browser.back)
  await close()
})

// The sizes and widths are this test's own: no size the twin draws at is asserted.
test('a label keeps its words whole on its lines, shrinks before it cuts, and cuts to an ellipsis only at its smallest size', () => {
  const fits = ({ size, lines }, width) => lines.every((line) => line.length * 0.6 * size <= width)
  for (const [text, width, rows, max, min] of [['Kick', 100, 2, 20, 10], ['Open Hat', 60, 2, 20, 10], ['one two three four five six', 80, 2, 20, 10], ['Reverberate', 70, 1, 20, 10]]) {
    const fitted = fit(text, width, rows, max, min)
    assert.ok(fits(fitted, width), `${text}: ${JSON.stringify(fitted)}`)
    assert.ok(fitted.lines.length <= rows && fitted.size <= max && fitted.size >= min)
    assert.equal(fitted.lines.join(' '), text, 'every word kept, in order')
  }
  assert.equal(fit('Kick', 100, 2, 20, 10).size, 20, 'a text that fits takes the largest size')
  assert.ok(fit('Reverberate', 70, 1, 20, 10).size < 20, 'a longer one shrinks')
  const cut = fit('Supercalifragilistic', 60, 2, 20, 10)
  assert.equal(cut.size, 10)
  assert.ok(fits(cut, 60) && cut.lines[0].endsWith('…') && 'Supercalifragilistic'.startsWith(cut.lines[0].slice(0, -1)))
  const long = fit('A'.repeat(16) + ' ' + 'B'.repeat(16), 80, 2, 12, 8)
  assert.deepEqual(long.lines.map((line) => line.length), [16, 16], 'two lines hold a display name\'s 32 characters')
  assert.equal(checked('Kick'), 'Kick')
  for (const bad of ['', '   ', 'a'.repeat(33), 'a\nb']) assert.throws(() => checked(bad), RangeError)
})

// The fields' limits are the SysEx layouts': 00 0A a 32-character name, 00 0B 5 characters (fixtures/ddj-flx10-rekordbox-connect.json frames 71, 72; unprobed).
test('a display takes the text its fields carry and names the field that does not fit', () => {
  const text = { name: 'LOW CUT ECHO', beat: '+1/16', bpm: 146.3, tap: false }
  assert.deepEqual(checkedText('beatFx', text), text)
  assert.deepEqual(checkedText('beatFx', { ...text, bpm: undefined }).bpm, undefined)
  assert.throws(() => checkedText('beatFx', { ...text, name: 'x'.repeat(33) }), /beatFx\.name/)
  assert.throws(() => checkedText('beatFx', { ...text, name: 'ÉCHO' }), /beatFx\.name/)
  assert.throws(() => checkedText('beatFx', { ...text, beat: '+1/160' }), /beatFx\.beat/)
  assert.throws(() => checkedText('beatFx', { ...text, bpm: 1000 }), /beatFx\.bpm/)
  assert.deepEqual(checkedText('jog1', { range: '±10%' }), { range: '±10%' })
  assert.throws(() => checkedText('jog1', { range: '±100.0%' }), /jog1\.range/)
  assert.throws(() => checkedText('jog1', text), RangeError)
  assert.throws(() => checkedText('beatFx', { range: '±10%' }), RangeError)
})
