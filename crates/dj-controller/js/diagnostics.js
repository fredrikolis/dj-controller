// Concern: the package's diagnostics entry: connect and inspect, the HID screens and WebUSB steps, from the diagnostics' own wasm loaded first | Non-concern: what each does (the Rust crate) | IO: none
import init, { connect as open, controlStep as sendStep, inspect, openScreens as openHid } from './diagnostics/dj_controller.js'

export { inspect }

// One load however many calls start together: a second instance would take over the glue from objects made in the first.
let loading
const loaded = () => (loading ??= init())

export async function connect(model, options) {
  await loaded()
  return open(model, options)
}

export async function openScreens(model) {
  await loaded()
  return openHid(model)
}

export async function controlStep(model, name) {
  await loaded()
  return sendStep(model, name)
}
