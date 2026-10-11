// Concern: moves a part's drawn nodes to show the state of the control it shows now | Non-concern: drawing them (draw.ts), where the state comes from | IO: (Part, View, State) -> SVG attributes
import { capAt, dims, type View } from './draw.js'
import type { State } from './follow.js'
import type { Part } from './types.js'

const FLASH_MS = 450
const KNOB_DEG = 135
const ENCODER_DEG = 15

const polar = (x: number, y: number, r: number, deg: number) => [x + r * Math.sin((deg * Math.PI) / 180), y - r * Math.cos((deg * Math.PI) / 180)]

function arc(x: number, y: number, r: number, from: number, to: number): string {
  const [x0, y0] = polar(x, y, r, from)
  const [x1, y1] = polar(x, y, r, to)
  return `M${x0} ${y0}A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1} ${y1}`
}

/** A colour number as the palette's `#rrggbb`, where the model's palette states one. */
export type Rgb = (colour: number) => string | undefined

/** Paints `state`, and `held` where a hold lit the control shown. */
export function paint(part: Part, view: View, state: State & { held: boolean }, rgb: Rgb): void {
  const { g } = view
  g.classList.toggle('down', state.down)
  g.classList.toggle('held', state.held)
  g.classList.toggle('lit', state.lit === true)
  const colour = state.colour === undefined ? undefined : rgb(state.colour)
  g.classList.toggle('coloured', colour !== undefined)
  if (colour === undefined) g.style.removeProperty('--told-colour')
  else g.style.setProperty('--told-colour', colour)
  g.style.setProperty('--velocity', String(state.velocity / 127))
  const [w, h] = dims(part.size)
  const f = state.fraction
  if (view.cap && part.shape === 'fader' && f !== undefined) {
    const { x, y } = capAt(part, f)
    view.cap.setAttribute('x', String(x))
    view.cap.setAttribute('y', String(y))
  }
  if (view.level) {
    view.level.setAttribute('y', String(part.y + h / 2 - (f ?? 0) * h))
    view.level.setAttribute('height', String((f ?? 0) * h))
  }
  if (view.pointer) {
    const deg = part.shape === 'knob' ? (f === undefined ? 0 : -KNOB_DEG + 2 * KNOB_DEG * f) : state.ticks * ENCODER_DEG
    view.pointer.setAttribute('transform', `rotate(${deg} ${part.x} ${part.y})`)
    if (view.arc && f !== undefined) view.arc.setAttribute('d', arc(part.x, part.y, w / 2 + 2, -KNOB_DEG, Math.max(-KNOB_DEG + 0.1, deg)))
  }
  if (state.turns !== undefined) view.mark?.setAttribute('transform', `rotate(${360 * state.turns} ${part.x} ${part.y})`)
}

/** Flashes a part's halo, in the shift colour where the press came with shift. */
export function flash(view: View, shift: boolean): void {
  if (!view.halo) return
  view.halo.classList.toggle('shift', shift)
  view.halo.getAnimations().forEach((a) => a.cancel())
  view.halo.animate([{ opacity: 0.9 }, { opacity: 0 }], { duration: FLASH_MS, easing: 'ease-out' })
}
