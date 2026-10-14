// Concern: what the twin promises a host, read from its own modules as the element needs a browser: every physical input of a model's controller has a part, a twin of some sections builds those alone and leaves a free area clear of them, a label shows on the bank it names, a text its labels or displays cannot carry is refused | Non-concern: drawing, pointer and keys, the element (browsers) | IO: (Device, virtual controller) -> assertions
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { testClock } from './clock.mjs'
import { Device } from './web-midi.mjs'

const pkg = process.env.DJ_CONTROLLER_PKG
const { initSync } = await import(join(pkg, 'dj_controller.js'))
initSync({ module: readFileSync(join(pkg, 'dj_controller_bg.wasm')) })
const { connect, virtual } = await import(join(pkg, 'index.js'))
const { checkedSections, layoutOf, place, placed, sectionsOf } = await import(join(pkg, 'twin/layout.js'))
const { build } = await import(join(pkg, 'twin/built.js'))
const { tree, showing, shownOf } = await import(join(pkg, 'twin/tree.js'))
const { checked } = await import(join(pkg, 'twin/labels.js'))
const { checkedText } = await import(join(pkg, 'twin/displays.js'))

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
  const clock = testClock()
  const flx = await clock.until(connect('DDJ-FLX10', { clock }))
  const shown = new Set(place(layoutOf(flx)).flatMap((part) => placed(part).map(({ control }) => control)))
  const missing = inputs(flx).filter(([, control]) => !shown.has(control)).map(([at]) => at)
  assert.deepEqual(missing, [])
  await flx.close()
})

test('a twin of no sections named builds every part of every panel and leaves no free area', async () => {
  const virt = await virtual('DDJ-FLX10')
  const layout = layoutOf(virt)
  const whole = build(layout, undefined)
  assert.equal(whole.parts.length, place(layout).length)
  assert.deepEqual(whole.panels, layout.panels.map((_, i) => i))
  assert.deepEqual(whole.free, [])
  await virt.close()
})

test('a twin of some sections builds their parts alone, each at its place, and its free area lies in its panel clear of them', async () => {
  const virt = await virtual('DDJ-FLX10')
  const layout = layoutOf(virt)
  const built = build(layout, sectionsOf(virt.model, ['deck 1/3', 'mixer', 'effects', 'deck 2/4 pads']))
  const controls = new Set(built.parts.flatMap((part) => placed(part).map(({ control }) => control)))
  const [left, right] = virt.decks
  for (const drawn of [left.cue, left.jog.touch, left.pads[0], virt.browser.rotate, virt.mixer.crossfader, virt.mixer.channels[3].fader, virt.mixer.channels[0].color, virt.effect.levelDepth, right.pads[7], right.padMode.sampler, right.page.left]) assert.ok(controls.has(drawn))
  for (const leftOut of [right.cue, right.playPause, right.shift, right.jog.touch, right.tempo, right.beatSync, right.quantize]) assert.ok(!controls.has(leftOut))
  const everywhere = place(layout)
  for (const part of built.parts) assert.ok(everywhere.some((whole) => whole.x === part.x && whole.y === part.y && whole.name === part.name && whole.section === part.section))
  assert.deepEqual(built.panels, [0, 1, 2])
  assert.equal(built.free.length, 1)
  const [{ panel, box: [x, y, w, h] }] = built.free
  assert.equal(layout.panels[panel].name, 'deck 2/4')
  const [px, py, pw, ph] = layout.panels[panel].box
  assert.ok(w > 0 && h > 0 && x >= px && y >= py && x + w <= px + pw && y + h <= py + ph)
  for (const part of built.parts.filter((p) => p.group !== undefined)) {
    const [sw, sh] = typeof part.size === 'number' ? [part.size * 2, part.size * 2] : part.size
    assert.ok(part.x + sw / 2 <= x || part.x - sw / 2 >= x + w || part.y + sh / 2 <= y || part.y - sh / 2 >= y + h, part.name)
  }
  assert.ok(built.shifts.some((shift) => shift.controls.some(({ control }) => control === right.shift)), 'a SHIFT not drawn is still the one its section plays under')
  assert.deepEqual(build(layout, sectionsOf(virt.model, ['mixer channel 1'])).panels, [1], 'a panel holding no section built is out of view')
  assert.deepEqual(build(layout, sectionsOf(virt.model, ['deck 1/3', 'deck 2/4'])).free.map((free) => layout.panels[free.panel].name), ['mixer'], 'a panel between two built is in view, all of it free')
  await virt.close()
})

test('sections are named whole or by one part, and a list of none or a name no model has is refused', () => {
  assert.deepEqual(sectionsOf('DDJ-FLX10', ['effects', 'deck 2/4 pads']), ['effects sound color', 'effects beat', 'deck 2/4 pads'])
  assert.deepEqual(checkedSections(['mixer', 'deck 1/3 jog']), ['mixer', 'deck 1/3 jog'])
  for (const bad of [[], ['deck'], ['deck 1/3', 'pads']]) assert.throws(() => checkedSections(bad), RangeError)
})

test("a label's bank is the view it names, the unshifted bank showing for a control, SHIFT's while held", async () => {
  const virt = await virtual('DDJ-FLX10')
  const { seats, owners } = tree(virt)
  const deck = virt.decks[0]
  const seat = seats.get(deck.pads[2])
  assert.equal(seats.get(deck.modes.sampler.pages[1].shifted.pads[2]), seat, 'a view sits at its control')
  const now = (shift) => showing(seat, shownOf(seat, owners), shift)
  assert.equal(now(false), deck.modes.hotCue.pages[0].pads[2])
  assert.equal(now(true), deck.modes.hotCue.pages[0].shifted.pads[2])
  virt.virtual.press(deck.padMode.sampler)
  assert.equal(now(false), deck.modes.sampler.pages[0].pads[2], 'a mode never seen comes up on its page 1')
  virt.virtual.press(deck.page.right)
  assert.equal(now(false), deck.modes.sampler.pages[1].pads[2])
  const cue = seats.get(deck.cue)
  assert.equal(showing(cue, shownOf(cue, owners), false), deck.cue)
  assert.equal(showing(cue, shownOf(cue, owners), true), deck.shifted.cue)
  const back = seats.get(virt.browser.back)
  virt.virtual.press(virt.decks[1].shift)
  assert.equal(shownOf(back, owners).shift, true, 'a control with no SHIFT of its own counts any held')
  assert.equal(showing(back, shownOf(back, owners), true), virt.shifted.browser.back)
  await virt.close()
})

// The fields' limits are the SysEx layouts': 00 0A a 32-character name, 00 0B 5 characters (fixtures/ddj-flx10-rekordbox-connect.json frames 71, 72; unprobed).
test('a label of 1 to 32 characters is taken, a display takes the text its fields carry, and each names what does not fit', () => {
  assert.equal(checked('Kick'), 'Kick')
  for (const bad of ['', '   ', 'a'.repeat(33), 'a\nb']) assert.throws(() => checked(bad), RangeError)
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
