// Concern: moves a part's drawn nodes to show the state of the control it shows now | Non-concern: drawing them (draw.ts), where the state comes from | IO: (Part, View, State) -> SVG attributes
import { aboveY, capAt, dims, inside, insideSize, type View } from './draw.js'
import type { BeatFxText, JogText } from '../index.js'
import { broken, fit } from './labels.js'
import { paintDisplay, paintJog } from './screens.js'
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

/** What a host shows on a part: its label, a display's text. */
export type Told = { readonly label?: string; readonly beatFx?: BeatFxText; readonly jog?: JogText }

/** A pad's label: up to two lines, 13 down to 9 a glyph, as `fit` wraps, shrinks and cuts it. */
function padLabel(part: Part, lines: readonly SVGElement[], label: string | undefined): void {
  const [w] = dims(part.size)
  const fitted = label === undefined ? { size: 13, lines: [] } : fit(label, w * 0.92, lines.length, 13, 9)
  lines.forEach((line, n) => {
    line.textContent = fitted.lines[n] ?? ''
    line.setAttribute('font-size', String(fitted.size))
    line.setAttribute('y', String(part.y + (n - (fitted.lines.length - 1) / 2) * fitted.size * 1.15))
  })
}

const LEGEND = 9
// A channel's meter stands 31 left of its knobs: a label keeps clear of it either side.
const ABOVE = { width: 62, max: 11, min: 8 }

/** A legend, or a host's label in its place: up to two lines stacked up from the part, one over a selector. */
function aboveLabel(part: Part, lines: readonly SVGElement[], label: string | undefined): void {
  const fitted = label === undefined ? { size: LEGEND, lines: part.label ? [part.label] : [] } : fit(broken(label, Math.floor(ABOVE.width / (0.6 * ABOVE.min))), ABOVE.width, part.shape === 'selector' ? 1 : lines.length, ABOVE.max, ABOVE.min)
  lines.forEach((line, n) => {
    line.textContent = fitted.lines[n] ?? ''
    line.setAttribute('font-size', String(fitted.size))
    line.setAttribute('y', String(aboveY(part) - (fitted.lines.length - 1 - n) * fitted.size * 1.1))
  })
}

/** Paints `state`, `held` where a hold lit the control shown, and what a host shows there. */
export function paint(part: Part, view: View, state: State & { held: boolean }, rgb: Rgb, told: Told = {}): void {
  const { g } = view
  g.classList.toggle('labelled', told.label !== undefined)
  if (view.lines) padLabel(part, view.lines, told.label)
  else if (view.above) aboveLabel(part, view.above, told.label)
  else if (view.text && inside(part)) {
    // A host's label takes the printed one's place, cut where even the smallest size does not fit it.
    const text = told.label === undefined ? (part.label ?? '') : fit(told.label, dims(part.size)[0] * 0.85, 1, 12, 5).lines[0]
    view.text.textContent = text
    view.text.setAttribute('font-size', String(insideSize(part, text.length)))
  }
  if (view.shown && part.shape === 'jog') paintJog(part, view.shown, state.screen, part.screens[state.at]?.deck ?? '', told.jog)
  if (view.shown && part.shape === 'display') paintDisplay(part, view.shown, state.channel, told.beatFx)
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
    const at = part.shape === 'selector' && state.position !== undefined ? part.positions[state.position] : undefined
    // A selector points at the dot of its position.
    const toward = at === undefined ? 0 : (Math.atan2(at.at[0] - part.at[0], part.at[1] - at.at[1]) * 180) / Math.PI
    if (part.shape === 'selector') g.setAttribute('aria-valuetext', at?.name ?? '')
    const deg = part.shape === 'selector' ? toward : part.shape === 'knob' ? (f === undefined ? 0 : -KNOB_DEG + 2 * KNOB_DEG * f) : state.ticks * ENCODER_DEG
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
