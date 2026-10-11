// Concern: draws one placed part as SVG and hands back the nodes its paint moves | Non-concern: what state it shows (paint.ts), placing it (layout.ts) | IO: (svg, Part) -> View
import type { Part } from './types.js'

const SVG = 'http://www.w3.org/2000/svg'

export type View = { g: SVGGElement; body?: SVGElement; halo?: SVGElement; cap?: SVGElement; pointer?: SVGElement; arc?: SVGElement; mark?: SVGElement; level?: SVGElement }

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

function label(g: SVGGElement, part: Part): void {
  if (!part.label) return
  const inside = part.shape === 'button' || part.shape === 'round'
  const [w, h] = dims(part.size)
  // A monospace glyph is about 0.6 em wide; an inside label shrinks to fit its part.
  const size = inside ? Math.max(5, Math.min(h * 0.5, 12, (w * 0.85) / (0.6 * part.label.length))) : 9
  const y = inside ? part.y : part.y - h / 2 - (part.shape === 'position' ? 3 : 5)
  el(g, 'text', { x: part.x, y, 'font-size': size, class: inside ? 'inside' : 'above' }).textContent = part.label
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
  } else if (part.shape === 'knob' || part.shape === 'encoder') {
    view.halo = body(g, part, 4, 'halo')
    body(g, part)
    if (part.shape === 'knob') view.arc = el(g, 'path', { class: 'arc' })
    view.pointer = el(g, 'line', { class: 'pointer', x1: x, y1: y, x2: x, y2: y - r })
  } else if (part.shape === 'spin') {
    view.halo = el(g, 'circle', { class: 'halo', cx: x, cy: y, r })
    el(g, 'circle', { class: 'track', cx: x, cy: y, r })
    // A mark only where the model states a revolution to turn it by.
    if (part.controls.some(({ control }) => control.revolution !== undefined)) view.mark = el(g, 'circle', { class: 'mark', cx: x, cy: y - r, r: 9 })
  } else if (part.shape === 'meter') {
    view.level = el(g, 'rect', { class: 'level', x: x - w / 2, y: y + h / 2, width: w, height: 0 })
    body(g, part)
  } else {
    view.halo = body(g, part, 3, 'halo')
    view.body = body(g, part)
  }
  label(g, part)
  return view
}
