// Concern: the package's main entry: connect, virtual and each model's palette, the driver's wasm loaded first | Non-concern: what they do (the Rust crate) | IO: (model, options) -> controller, palette
import init, { connect as open, palette as paletteOf, virtual as unplugged } from './dj_controller.js'

// One load however many calls start together: a second instance would take over the glue from objects made in the first.
let loading
const loaded = () => (loading ??= init())

export async function connect(model, options) {
  await loaded()
  return open(model, options)
}

export async function palette(model) {
  await loaded()
  return paletteOf(model)
}

export async function virtual(model, options) {
  await loaded()
  return unplugged(model, options)
}
