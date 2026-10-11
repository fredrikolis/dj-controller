// Concern: follows one placed control's typed streams until the signal aborts or the controller closes, as patches to its part's state | Non-concern: painting, writes | IO: (part, signal) -> patches
import type { Telling } from '../index.js'
import type { Id, Part } from './types.js'

/** What the device last reported of one control, and what its LED or colour was last told, as the twin draws it: `turns`, a relative control's revolutions, where its model states its ticks a revolution. */
export type State = { down: boolean; shift: boolean; velocity: number; fraction: number | undefined; ticks: number; turns: number | undefined; lit: boolean | undefined; colour: number | undefined }

export const initial = (): State => ({ down: false, shift: false, velocity: 0, fraction: undefined, ticks: 0, turns: undefined, lit: undefined, colour: undefined })

export type Sink = { set(patch: Partial<State>): void; flash(shift: boolean): void }

const withShift = (id: Id) => id.shift === true

/** The next animation frame; rejects with the signal's reason once it aborts, its frame cancelled. */
function frame(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)
    const abort = () => {
      cancelAnimationFrame(id)
      reject(signal.reason)
    }
    const id = requestAnimationFrame(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    })
    signal.addEventListener('abort', abort, { once: true })
  })
}

/** Follows a control and its shifted view, where placed, at once. */
async function layers<C>(control: C, shifted: C | undefined, follow: (layer: C, shift: boolean) => Promise<void>): Promise<void> {
  await Promise.all([follow(control, false), shifted !== undefined && follow(shifted, true)])
}

/** Follows what an LED or pad colour was told, by whichever path. */
async function told<T>(control: Telling<T>, signal: AbortSignal, set: (value: T | undefined) => void): Promise<void> {
  set(control.told)
  for await (const value of control.toldChanges({ signal })) set(value)
}

/** Follows the `at`th control `part` shows, reading an absolute or relative control's latest-value stream once a frame. Rejects with the signal's reason once it aborts; resolves when the controller closes. */
export async function follow(part: Part, at: number, signal: AbortSignal, sink: Sink): Promise<void> {
  if (part.shape === 'pad') {
    const { control } = part.controls[at]
    const hits = async () => {
      for await (const hit of control.hits({ signal })) {
        sink.flash(withShift(hit))
        sink.set({ down: true, shift: withShift(hit), velocity: hit.velocity })
        await hit.released
        sink.set({ down: false })
      }
    }
    await Promise.all([hits(), 'colour' in control && told(control, signal, (colour) => sink.set({ colour }))])
  } else if (part.shape === 'button' || part.shape === 'round' || part.shape === 'touch') {
    const { control } = part.controls[at]
    const shown = (id: Id) => part.decks === undefined || id.deck === undefined || part.decks.includes(id.deck)
    const presses = async () => {
      for await (const press of control.presses({ signal })) {
        if (!shown(press)) continue
        sink.flash(withShift(press))
        sink.set({ down: true, shift: withShift(press) })
        await press.released
        sink.set({ down: false })
      }
    }
    await Promise.all([presses(), 'led' in control && told(control, signal, (lit) => sink.set({ lit }))])
  } else if (part.shape === 'fader' || part.shape === 'knob') {
    const { control, shifted } = part.controls[at]
    const value = control.value ?? shifted?.value
    if (value !== undefined) sink.set({ fraction: value / control.max })
    await layers(control, shifted, async (layer, shift) => {
      for await (const value of layer.changes({ signal })) {
        sink.set({ fraction: value / layer.max })
        sink.flash(shift)
        await frame(signal)
      }
    })
  } else if (part.shape === 'position') {
    const { control, shifted } = part.controls[at]
    sink.set({ down: (control.on ?? shifted?.on) === true })
    await layers(control, shifted, async (layer) => {
      for await (const { on } of layer.changes({ signal })) sink.set({ down: on })
    })
  } else if (part.shape === 'encoder' || part.shape === 'spin') {
    const { control, shifted } = part.controls[at]
    const turned = () => {
      const ticks = control.position.ticks + (shifted?.position.ticks ?? 0)
      return { ticks, turns: control.revolution === undefined ? undefined : ticks / control.revolution }
    }
    sink.set(turned())
    await layers(control, shifted, async (layer, shift) => {
      for await (const _ of layer.positions({ signal })) {
        sink.set(turned())
        sink.flash(shift)
        await frame(signal)
      }
    })
  } else if (part.shape === 'meter') {
    const { control } = part.controls[at]
    if (control.range === undefined) throw new TypeError('a meter shows a value output with a range')
    const [low, high] = control.range
    const fraction = (value: number) => Math.min(1, Math.max(0, (value - low) / Math.max(1, high - low)))
    await told(control, signal, (value) => sink.set({ fraction: value === undefined ? undefined : fraction(value) }))
  } else if (part.shape === 'screen') {
    await told(part.controls[at].control, signal, (value) => sink.set({ lit: value === undefined ? undefined : value > 0 }))
  }
}
