// Concern: each entry loads its wasm once however many calls start together, with no load forced first, and every result works afterwards | Non-concern: what the calls do (connect.test.mjs) | IO: (concurrent calls) -> assertions
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { Device } from './web-midi.mjs'

const pkg = process.env.DJ_CONTROLLER_PKG

// The glue fetches its wasm beside itself: served from the installed file a turn later, as a network would, each fetch counted.
const fetched = []
globalThis.fetch = async (url) => {
  fetched.push(String(url))
  await new Promise((resolve) => setImmediate(resolve))
  return new Response(readFileSync(fileURLToPath(url)), { headers: { 'content-type': 'application/wasm' } })
}
const loads = (wasm) => fetched.filter((url) => url.endsWith(wasm)).length

test('palette, connect and palette started together load the main wasm once, and each result works afterwards', async () => {
  const { connect, palette } = await import(join(pkg, 'index.js'))
  new Device().install()
  const [first, flx, second] = await Promise.all([palette('DDJ-FLX10'), connect('DDJ-FLX10'), palette('DDJ-FLX10')])
  assert.equal(loads('/dj_controller_bg.wasm') - loads('/diagnostics/dj_controller_bg.wasm'), 1)
  // An object made in an instance that a later load replaced reads the wrong memory.
  for (const colours of [first, second, flx.palette]) assert.equal(colours.colour(1).name, 'blue')
  await flx.decks[0].playPause.led(true)
  assert.equal(flx.decks[0].playPause.told, true)
  assert.equal((await palette('DDJ-FLX10')).colour(1).name, 'blue')
  await flx.close()
})

test('two diagnostics calls started together load the diagnostics wasm once', async () => {
  const diagnostics = await import(join(pkg, 'diagnostics.js'))
  new Device().install()
  const [flx, step] = await Promise.allSettled([diagnostics.connect('DDJ-FLX10'), diagnostics.controlStep('DDJ-FLX10', 'wake')])
  assert.equal(loads('/diagnostics/dj_controller_bg.wasm'), 1)
  assert.equal(flx.status, 'fulfilled', String(flx.reason))
  assert.equal(step.status, 'rejected', 'Node has no WebUSB')
  assert.equal(flx.value.palette.colour(1).name, 'blue')
  await flx.value.close()
})
