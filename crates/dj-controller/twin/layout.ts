// Concern: each model's twin layout for its controller, its parts placed on the panel | Non-concern: the layout types (types.ts), drawing, following | IO: (controller) -> Layout, Part[]
import type { Controllers, ModelName } from '../index.js'
import { layout as ddjFlx10 } from './layouts/ddj-flx10.js'
import type { Layout, Part, Placed } from './types.js'

export type Twinned = Controllers[ModelName]

export function layoutOf(controller: Twinned): Layout {
  switch (controller.model) {
    case 'DDJ-FLX10':
      return ddjFlx10(controller)
  }
}

export function place(layout: Layout): Part[] {
  return layout.sections.flatMap(({ at, name, parts }) => parts.map((entry) => ({ ...entry, x: entry.at[0] + at[0], y: entry.at[1] + at[1], section: name })))
}

export function placed(part: Part): readonly Placed<unknown>[] {
  return part.shape === 'passive' ? [] : part.controls
}
