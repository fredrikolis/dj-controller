// Concern: a virtual controller's hands on one placed part: pointer, key and wheel as its control's gestures | Non-concern: DOM events (hold.ts), a gesture's message | IO: (part, point, key) -> gestures
import type { Absolute, Button, Pad, Relative, Switch, VirtualGestures } from '../index.js'
import { dims } from './draw.js'
import type { Part } from './types.js'

export type Point = { readonly x: number; readonly y: number }

/** One part's hands: `down` to `up` is one hold or drag, in the layout's units; `key` answers whether it took the key. */
export type Hands = { down(at: Point, shift: boolean): void; move(at: Point): void; up(): void; key(key: string, down: boolean, shift: boolean): boolean; wheel?(steps: number): void; reset?(): void; readonly role: 'button' | 'slider' | 'switch' }

/** What hands need of their twin: the gestures, which placed control shows, the SHIFT this part plays under, whether its owner's SHIFT is held, a timer. */
export type Reach = {
  readonly unit: VirtualGestures
  shown(): number
  shift(): Button<unknown> | undefined
  shifted(): boolean
  later(ms: number, run: () => void): () => void
}

/** How long a hold lasts before its `long-press` layer is pressed too: the unit's own threshold is unobserved; 1 s assumed. */
export const LONG_PRESS_MS = 1000
/** A knob's whole travel, and an encoder's one tick, in the layout's units of drag. */
const KNOB_TRAVEL = 150
const ENCODER_STEP = 10
const KEY_STEPS = 64
const PRESSING = new Set(['Enter', ' '])
const UP = new Set(['ArrowUp', 'ArrowRight'])
const DOWN = new Set(['ArrowDown', 'ArrowLeft'])

/** Holds the part's SHIFT for one gesture where the keyboard's Shift came with it and no hand holds SHIFT already. */
function borrowing(reach: Reach): { take(shift: boolean): void; give(): void } {
  let borrowed: Button<unknown> | undefined
  return {
    take(shift) {
      const button = reach.shift()
      if (!shift || !button || button.pressed) return
      reach.unit.press(button)
      borrowed = button
    },
    give() {
      if (borrowed) reach.unit.release(borrowed)
      borrowed = undefined
    },
  }
}

/** A hold from the first of pointer, Enter or Space down to its release. */
function held(press: (shift: boolean) => void, release: () => void, extra: Partial<Hands> = {}): Hands {
  let down = false
  const start = (shift: boolean) => {
    if (down) return
    down = true
    press(shift)
  }
  const end = () => {
    if (!down) return
    down = false
    release()
  }
  return { role: 'button', down: (_, shift) => start(shift), move() {}, up: end, key: (key, pressed, shift) => PRESSING.has(key) && ((pressed ? start(shift) : end()), true), ...extra }
}

function button(part: Part & { shape: 'button' | 'round' | 'touch' }, reach: Reach): Hands {
  const control = () => part.controls[reach.shown()].control
  const { unit } = reach
  if (part.latches) {
    const toggle = () => (control().pressed ? unit.release(control()) : unit.press(control()))
    return { role: 'switch', down: toggle, move() {}, up() {}, key: (key, pressed) => PRESSING.has(key) && (pressed && toggle(), true) }
  }
  const shift = borrowing(reach)
  let pressed: Button<unknown> | undefined
  let cancel = () => {}
  return held(
    (withShift) => {
      const now = control()
      shift.take(withShift)
      // A shared control's press names the deck in control among its decks.
      unit.press(now, part.decks ? { index: part.decks[reach.shown()] } : undefined)
      pressed = now
      if (unit.layers(now).includes('long-press')) cancel = reach.later(LONG_PRESS_MS, () => unit.press(now, { layer: 'long-press' }))
    },
    () => {
      cancel()
      if (pressed) unit.release(pressed)
      pressed = undefined
      shift.give()
    },
  )
}

function pad(part: Part & { shape: 'pad' }, reach: Reach): Hands {
  const shift = borrowing(reach)
  let hit: Pad<unknown> | undefined
  return held(
    (withShift) => {
      shift.take(withShift)
      hit = part.controls[reach.shown()].control
      // A pointer and a key have no force: every hit is the hardest.
      reach.unit.hit(hit, 127)
    },
    () => {
      if (hit) reach.unit.lift(hit)
      hit = undefined
      shift.give()
    },
  )
}

/** A fader's or knob's hands: `value` of a drag from where it went down; arrow keys step it, Home and End end it. */
function absolute(control: () => Absolute, reach: Reach, value: (from: Point, v0: number, at: Point, max: number) => number, centre: boolean): Hands {
  const shift = borrowing(reach)
  let from: { at: Point; v0: number; control: Absolute } | undefined
  const set = (c: Absolute, v: number) => {
    const whole = Math.round(Math.min(c.max, Math.max(0, v)))
    if (whole !== c.value) reach.unit.move(c, whole)
  }
  const rest = (c: Absolute) => c.value ?? Math.ceil(c.max / 2)
  return {
    role: 'slider',
    down(at, withShift) {
      shift.take(withShift)
      from = { at, v0: rest(control()), control: control() }
      set(from.control, value(from.at, from.v0, at, from.control.max))
    },
    move(at) {
      if (from) set(from.control, value(from.at, from.v0, at, from.control.max))
    },
    up() {
      from = undefined
      shift.give()
    },
    key(key, pressed) {
      const c = control()
      const to = UP.has(key) ? rest(c) + c.max / KEY_STEPS : DOWN.has(key) ? rest(c) - c.max / KEY_STEPS : key === 'Home' ? 0 : key === 'End' ? c.max : undefined
      if (to !== undefined && pressed) set(c, to)
      return to !== undefined
    },
    ...(centre ? { reset: () => set(control(), Math.ceil(control().max / 2)) } : {}),
  }
}

function fader(part: Part & { shape: 'fader' }, reach: Reach): Hands {
  const [w, h] = dims(part.size)
  const along = (at: Point) => {
    const f = h > w ? (part.y + h / 2 - at.y) / h : (at.x - (part.x - w / 2)) / w
    return part.reversed ? 1 - f : f
  }
  return absolute(() => part.controls[reach.shown()].control, reach, (_, __, at, max) => along(at) * max, false)
}

function knob(part: Part & { shape: 'knob' }, reach: Reach): Hands {
  return absolute(() => part.controls[reach.shown()].control, reach, (from, v0, at, max) => v0 + ((from.y - at.y) / KNOB_TRAVEL) * max, true)
}

function position(part: Part & { shape: 'position' }, reach: Reach): Hands | undefined {
  const control = (): Switch => part.controls[reach.shown()].control
  const kind = reach.unit.flips(control())
  if (kind === undefined) return undefined
  const flip = () => {
    const now = control()
    if (kind === 'toggle') reach.unit.flip(now, now.on !== true)
    else if (now.on !== true) reach.unit.flip(now, true)
  }
  return { role: 'switch', down: flip, move() {}, up() {}, key: (key, pressed) => PRESSING.has(key) && (pressed && flip(), true) }
}

/** Turns in whole ticks, the fraction left carried to the next. */
function turning(turn: (ticks: number) => void): (ticks: number) => void {
  let carry = 0
  return (ticks) => {
    carry += ticks
    const whole = Math.trunc(carry)
    carry -= whole
    if (whole !== 0) turn(whole)
  }
}

function spin(part: Part & { shape: 'spin' }, reach: Reach): Hands {
  const control = (): Relative<unknown> => part.controls[reach.shown()].control
  const revolution = (c: Relative<unknown>): number => {
    const ticks = c.revolution ?? part.ticks
    if (ticks === undefined) throw new TypeError('a spin turns by its model\'s revolution, or its layout\'s ticks')
    return ticks
  }
  // SHIFT held, a device sends its SHIFT layer, which has no other word.
  const layer = () => ({ layer: reach.shifted() ? '' : (part.layer ?? '') })
  const turn = turning((ticks) => reach.unit.turn(control(), ticks, layer()))
  const angle = (at: Point) => Math.atan2(at.x - part.x, part.y - at.y) / (2 * Math.PI)
  const shift = borrowing(reach)
  let last: number | undefined
  let touched: Button<unknown> | undefined
  return {
    role: 'slider',
    down(at, withShift) {
      shift.take(withShift)
      last = angle(at)
      touched = part.touch?.[reach.shown()]
      if (touched && !touched.pressed) reach.unit.press(touched)
      else touched = undefined
    },
    move(at) {
      if (last === undefined) return
      const now = angle(at)
      // The short way round.
      const turned = now - last - Math.round(now - last)
      last = now
      turn(turned * revolution(control()))
    },
    up() {
      last = undefined
      if (touched) reach.unit.release(touched)
      touched = undefined
      shift.give()
    },
    key(key, pressed) {
      const way = UP.has(key) ? 1 : DOWN.has(key) ? -1 : 0
      if (way !== 0 && pressed) turn((way * revolution(control())) / KEY_STEPS)
      return way !== 0
    },
  }
}

function encoder(part: Part & { shape: 'encoder' }, reach: Reach): Hands {
  const control = (): Relative<unknown> => part.controls[reach.shown()].control
  const turn = turning((ticks) => reach.unit.turn(control(), ticks))
  const shift = borrowing(reach)
  let last: number | undefined
  return {
    role: 'slider',
    down(at, withShift) {
      shift.take(withShift)
      last = at.y
    },
    move(at) {
      if (last === undefined) return
      turn((last - at.y) / ENCODER_STEP)
      last = at.y
    },
    up() {
      last = undefined
      shift.give()
    },
    key(key, pressed) {
      const way = UP.has(key) ? 1 : DOWN.has(key) ? -1 : 0
      if (way !== 0 && pressed) turn(way)
      return way !== 0
    },
    wheel: (steps) => turn(steps),
  }
}

/** The hands a virtual controller's `part` takes; none for a part no hand moves. */
export function hands(part: Part, reach: Reach): Hands | undefined {
  switch (part.shape) {
    case 'button':
    case 'round':
    case 'touch':
      return button(part, reach)
    case 'pad':
      return pad(part, reach)
    case 'fader':
      return fader(part, reach)
    case 'knob':
      return knob(part, reach)
    case 'position':
      return position(part, reach)
    case 'spin':
      return spin(part, reach)
    case 'encoder':
      return encoder(part, reach)
    default:
      return undefined
  }
}
