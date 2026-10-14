// Concern: what a twin builds of a layout: its sections' parts, the panels in view, each one's free area | Non-concern: naming sections (layout.ts), drawing | IO: (Layout, sections) -> Built
import type { TwinSection } from '../index.js'
import { dims } from './draw.js'
import { place } from './layout.js'
import type { Box, Layout, Part } from './types.js'

/** `homes`: the panel each part sits in; `panels`: those in view, first to last holding a built section; `free`: in each with a section left out, the largest box clear of what is built; `shifts`: the unit's, built or not. */
export type Built = { readonly parts: Part[]; readonly homes: number[]; readonly panels: readonly number[]; readonly free: readonly { readonly panel: number; readonly box: Box }[]; readonly shifts: readonly Part[] }

const CLEAR = 14

type Span = readonly [number, number, number, number]

const extent = (part: Part): Span => {
  const [w, h] = dims(part.size)
  return [part.x - w / 2, part.y - h / 2, part.x + w / 2, part.y + h / 2]
}

/** The largest box in `within` clear of `taken`. */
function largest(within: Span, taken: readonly Span[]): Box | undefined {
  const [left, top, right, bottom] = within
  const edges = [...new Set([left, right, ...taken.flatMap(([x0, , x1]) => [x0, x1])])].filter((x) => x >= left && x <= right).sort((a, b) => a - b)
  let best: Box | undefined
  edges.forEach((x0, i) => {
    for (const x1 of edges.slice(i + 1)) {
      const across = taken.filter((span) => span[0] < x1 && span[2] > x0).sort((a, b) => a[1] - b[1])
      let y0 = top
      for (const [, from, , to] of [...across, [x0, bottom, x1, bottom] as const]) {
        const height = Math.min(from, bottom) - y0
        if (height > 0 && (x1 - x0) * height > (best ? best[2] * best[3] : 0)) best = [x0, y0, x1 - x0, height]
        y0 = Math.max(y0, to)
      }
    }
  })
  return best
}

/** `sections` of `layout`, all where undefined. */
export function build(layout: Layout, sections: readonly TwinSection[] | undefined): Built {
  const all = place(layout)
  const home = (part: Part) => layout.panels.findIndex(({ box: [x, y, w, h] }) => part.x >= x && part.x < x + w && part.y >= y && part.y < y + h)
  const lost = all.findIndex((part) => home(part) < 0)
  if (lost >= 0) throw new RangeError(`part ${lost} lies outside every panel`)
  const asked = (part: Part) => part.group !== undefined && (sections === undefined || sections.includes(part.group))
  const holding = new Set(all.filter(asked).map(home))
  const panels = layout.panels.map((_, i) => i).filter((i) => i >= Math.min(...holding) && i <= Math.max(...holding))
  const parts = all.filter((part) => (part.group === undefined ? holding.has(home(part)) : asked(part)))
  // One span a section: no free area opens between its own parts.
  const spans = new Map<TwinSection, Span>()
  for (const part of parts) {
    if (part.group === undefined) continue
    const [a, b] = [spans.get(part.group), extent(part)]
    spans.set(part.group, a ? [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])] : b)
  }
  const taken = [...spans.values()].map(([x0, y0, x1, y1]): Span => [x0 - CLEAR, y0 - CLEAR, x1 + CLEAR, y1 + CLEAR])
  const free = panels.flatMap((panel) => {
    const [x, y, w, h] = layout.panels[panel].box
    if (all.every((part) => part.group === undefined || home(part) !== panel || asked(part))) return []
    const box = largest([x + CLEAR, y + CLEAR, x + w - CLEAR, y + h - CLEAR], taken)
    return box ? [{ panel, box }] : []
  })
  return { parts, homes: parts.map(home), panels, free, shifts: all.filter((part) => part.shape === 'button' && part.latches) }
}
