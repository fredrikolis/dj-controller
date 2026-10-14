// Concern: each model's twin layout, its parts placed, the sections a host names | Non-concern: the layout types (types.ts), what a twin builds (built.ts) | IO: (controller) -> Layout, Part[]
import type { Controllers, ModelName, Virtual, TwinSection } from '../index.js'
import { layout as ddjFlx10, sections as ddjFlx10Sections } from './layouts/ddj-flx10.js'
import type { Layout, Part, Placed } from './types.js'

/** A controller the twin draws: connected, or virtual, which it also plays. */
export type Twinned = Controllers[ModelName] | Virtual<Controllers[ModelName]>

export function layoutOf(controller: Twinned): Layout {
  switch (controller.model) {
    case 'DDJ-FLX10':
      return ddjFlx10(controller)
  }
}

const SECTIONS: Readonly<Record<ModelName, Readonly<Record<string, readonly TwinSection[]>>>> = { 'DDJ-FLX10': ddjFlx10Sections }

/** Refused where empty or naming a section no model has. */
export function checkedSections(names: readonly TwinSection[]): readonly TwinSection[] {
  if (names.length === 0) throw new RangeError('a twin of no section draws nothing: name a section, or leave `sections` out for the whole unit')
  const known = Object.values(SECTIONS).flatMap((sections) => Object.keys(sections))
  const unknown = names.filter((name) => !known.includes(name))
  if (unknown.length) throw new RangeError(`no model has a section ${unknown.map((name) => JSON.stringify(name)).join(', ')}: the sections are ${known.join(', ')}`)
  return [...names]
}

export function sectionsOf(model: ModelName, names: readonly TwinSection[]): readonly TwinSection[] {
  return names.flatMap((name) => {
    const whole = SECTIONS[model][name]
    if (!whole) throw new RangeError(`the ${model} has no section ${JSON.stringify(name)}: its sections are ${Object.keys(SECTIONS[model]).join(', ')}`)
    return whole
  })
}

export function place(layout: Layout): Part[] {
  return layout.sections.flatMap(({ at, group, name, parts }) => parts.map((entry) => ({ ...entry, x: entry.at[0] + at[0], y: entry.at[1] + at[1], section: name, group })))
}

export function placed(part: Part): readonly Placed<unknown>[] {
  // A display and a selector show no one control of their own: one seat each.
  return part.shape === 'passive' ? [] : part.shape === 'display' || part.shape === 'selector' ? [{ control: part }] : part.controls
}
