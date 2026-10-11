// Concern: the package's main entry: connect and each model's palette, loading the driver's wasm first | Non-concern: everything they do (the Rust crate) | IO: (model, options) -> controller, palette
import init, { connect as open, palette as paletteOf } from './dj_controller.js'

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
