// Concern: draws one placed part as SVG and hands back the nodes its paint moves | Non-concern: what state it shows (paint.ts), placing it (layout.ts) | IO: (svg, Part) -> View
import { drawDisplay, drawJog, type ScreenNodes } from './screens.js'
import type { Part } from './types.js'

const SVG = 'http://www.w3.org/2000/svg'

/** `text`: a button's printed label, where a host's label goes; `lines`: a pad's two; `above`: a knob's, fader's or selector's legend, a host's label in its place; `shown`: a screen's or display's fields. */
export type View = { g: SVGGElement; above?: readonly SVGElement[]; body?: SVGElement; halo?: SVGElement; cap?: SVGElement; pointer?: SVGElement; arc?: SVGElement; mark?: SVGElement; level?: SVGElement; text?: SVGElement; lines?: readonly SVGElement[]; shown?: ScreenNodes }

export function el<K extends keyof SVGElementTagNameMap>(parent: Element | null, name: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, name)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v))
  parent?.append(node)
  return node
}

type Fader = Extract<Part, { shape: 'fader' }>

export const dims = (size: number | readonly [number, number]): readonly [number, number] => (typeof size === 'number' ? [size * 2, size * 2] : size)

/** A fader's cap at `fraction` of its value, along its long side: from the bottom (or left) up, from the top (or right) down where `reversed`. */
export function capAt(part: Fader, fraction: number): { x: number; y: number; width: number; height: number } {
  const [w, h] = dims(part.size)
  const f = part.reversed ? 1 - fraction : fraction
  return h > w ? { x: part.x - w / 2, y: part.y + h / 2 - 6 - f * h, width: w, height: 12 } : { x: part.x - w / 2 - 6 + f * w, y: part.y - h / 2, width: 12, height: h }
}

/** A part's body as a circle (`size` a radius) or a rectangle (`size` [w, h]), centred on it. */
function body(g: SVGGElement, part: Part, grow = 0, cls = 'body'): SVGElement {
  const { x, y, size } = part
  if (typeof size === 'number') return el(g, 'circle', { class: cls, cx: x, cy: y, r: size + grow })
  const [w, h] = [size[0] + grow * 2, size[1] + grow * 2]
  return el(g, 'rect', { class: cls, x: x - w / 2, y: y - h / 2, width: w, height: h, rx: Math.min(4, h / 4) })
}

export const inside = (part: Part): boolean => part.shape === 'button' || part.shape === 'round'

export function insideSize(part: Part, length: number): number {
  const [w, h] = dims(part.size)
  return Math.max(5, Math.min(h * 0.5, 12, (w * 0.85) / (0.6 * Math.max(1, length))))
}

/** The shapes whose legend, or a host's label, goes above them. */
export const turned = (part: Part): boolean => part.shape === 'knob' || part.shape === 'fader' || part.shape === 'selector' || part.shape === 'encoder'

export function aboveY(part: Part): number {
  const [w, h] = dims(part.size)
  // An upright fader's cap rides 6 past its slot's top.
  const cap = part.shape === 'fader' && h > w ? 6 : 0
  const top = part.shape === 'selector' ? Math.min(...part.positions.map((p) => p.at[1])) + part.y - part.at[1] - 4 : part.y - h / 2
  return top - cap - (part.shape === 'position' ? 3 : 5)
}

function label(g: SVGGElement, part: Part): SVGElement | undefined {
  if (turned(part) || (!inside(part) && !part.label)) return undefined
  const size = inside(part) ? insideSize(part, part.label?.length ?? 1) : 9
  const y = inside(part) ? part.y : aboveY(part)
  const text = el(g, 'text', { x: part.x, y, 'font-size': size, class: inside(part) ? 'inside' : 'above' })
  text.textContent = part.label ?? ''
  return text
}

export function draw(svg: SVGSVGElement, part: Part): View {
  const g = el(svg, 'g', { class: `part ${part.shape}` })
  const view: View = { g }
  const { x, y } = part
  const [w, h] = dims(part.size)
  const r = w / 2
  if (part.shape === 'passive') {
    body(g, part, 0, 'passive')
  } else if (part.shape === 'fader') {
    el(g, 'rect', h > w ? { class: 'slot', x: x - 2, y: y - h / 2, width: 4, height: h } : { class: 'slot', x: x - w / 2, y: y - 2, width: w, height: 4 })
    view.halo = el(g, 'rect', { class: 'halo', x: x - w / 2 - 3, y: y - h / 2 - 3, width: w + 6, height: h + 6, rx: 4 })
    view.cap = el(g, 'rect', { class: 'cap', rx: 2, ...capAt(part, 0) })
  } else if (part.shape === 'knob' || part.shape === 'encoder' || part.shape === 'selector') {
    view.halo = body(g, part, 4, 'halo')
    body(g, part)
    if (part.shape === 'knob') view.arc = el(g, 'path', { class: 'arc' })
    view.pointer = el(g, 'line', { class: 'pointer', x1: x, y1: y, x2: x, y2: y - r })
  } else if (part.shape === 'spin') {
    view.halo = el(g, 'circle', { class: 'halo', cx: x, cy: y, r })
    el(g, 'circle', { class: 'track', cx: x, cy: y, r })
    el(g, 'circle', { class: 'reach', cx: x, cy: y, r })
    // A mark only where the model states a revolution to turn it by.
    if (part.controls.some(({ control }) => control.revolution !== undefined)) view.mark = el(g, 'circle', { class: 'mark', cx: x, cy: y - r, r: 9 })
  } else if (part.shape === 'jog' || part.shape === 'display') {
    body(g, part)
    view.shown = part.shape === 'jog' ? drawJog(g, part) : drawDisplay(g, part)
  } else if (part.shape === 'pad') {
    view.halo = body(g, part, 3, 'halo')
    view.body = body(g, part)
    view.lines = [el(g, 'text', { x, class: 'told' }), el(g, 'text', { x, class: 'told' })]
  } else if (part.shape === 'meter') {
    view.level = el(g, 'rect', { class: 'level', x: x - w / 2, y: y + h / 2, width: w, height: 0 })
    body(g, part)
  } else {
    view.halo = body(g, part, 3, 'halo')
    view.body = body(g, part)
    // A selector's dot is small: its hit area is a little larger, short of its neighbours'.
    if (part.shape === 'position' && typeof part.size === 'number') el(g, 'circle', { class: 'reach', cx: x, cy: y, r: part.size + 1.5 })
  }
  view.text = label(g, part)
  if (turned(part)) view.above = [el(g, 'text', { x, class: 'above' }), el(g, 'text', { x, class: 'above' })]
  return view
}
