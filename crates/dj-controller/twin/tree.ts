// Concern: where each control sits in its controller's tree: its owner of pad modes, its bank views, and which of them shows now | Non-concern: drawing, the labels themselves | IO: (controller) -> seats
import type { Listen, Feed, Shown } from '../index.js'

export type Owner = { readonly mode: Shown<string, number>; modeChanges(options?: Listen): Feed<Shown<string, number>> }

export type Bank = { readonly mode?: string; readonly page?: number; readonly shift: boolean; readonly view: object }

/** A physical control's place; `banked` where its plain layer is itself a pad mode's bank. */
export type Seat = { readonly control: object; readonly owner: Owner | undefined; readonly banks: readonly Bank[]; readonly banked: boolean }

export type Tree = { readonly seats: ReadonlyMap<object, Seat>; readonly owners: readonly Owner[] }

type Group = Readonly<Record<string, unknown>>
type Path = readonly (string | number)[]

const group = (node: unknown): node is Group => typeof node === 'object' && node !== null && Object.getPrototypeOf(node) === Object.prototype
const STREAMS = ['presses', 'hits', 'changes', 'positions', 'toldChanges']
const control = (node: unknown): node is object => typeof node === 'object' && node !== null && !Array.isArray(node) && !group(node) && STREAMS.some((s) => s in node)
const owns = (node: Group): node is Group & Owner => typeof node.modeChanges === 'function' && typeof node.mode === 'object'
// Views and a controller's own members are no physical controls.
const SKIPPED = new Set(['modes', 'shifted', 'virtual', 'palette', 'closed'])

function at(node: unknown, path: Path): object | undefined {
  let here = node
  for (const step of path) {
    if (typeof here !== 'object' || here === null) return undefined
    here = (here as Record<string | number, unknown>)[step]
  }
  return control(here) ? here : undefined
}

function banks(owner: Group, path: Path): Bank[] {
  const found: Bank[] = []
  const add = (root: unknown, bank: Omit<Bank, 'view' | 'shift'>) => {
    if (!group(root)) return
    for (const shift of [false, true]) {
      const view = at(shift ? root.shifted : root, path)
      if (view && !found.some((b) => b.view === view)) found.push({ ...bank, shift, view })
    }
  }
  add({ shifted: owner.shifted }, {})
  if (!group(owner.modes)) return found.filter((b) => b.shift)
  for (const [mode, views] of Object.entries(owner.modes)) {
    if (!group(views)) continue
    add(views, { mode })
    if (Array.isArray(views.pages)) views.pages.forEach((page, n) => add(page, { mode, page: n }))
  }
  return found.filter((b) => b.shift || b.mode !== undefined)
}

export function tree(controller: object): Tree {
  const seats = new Map<object, Seat>()
  const owners: Owner[] = []
  const walk = (node: unknown, owner: Group, path: Path): void => {
    if (Array.isArray(node)) return node.forEach((item, i) => walk(item, owner, [...path, i]))
    if (group(node)) {
      const mine = owns(node)
      if (mine) owners.push(node)
      for (const [name, value] of Object.entries(node)) if (!SKIPPED.has(name)) walk(value, mine ? node : owner, mine ? [name] : [...path, name])
    } else if (control(node)) {
      const views = banks(owner, path)
      const seat: Seat = { control: node, owner: owns(owner) ? owner : undefined, banks: views, banked: views.some((b) => b.mode !== undefined) }
      seats.set(node, seat)
      for (const bank of views) seats.set(bank.view, seat)
    }
  }
  if (group(controller)) walk(controller, controller, [])
  return { seats, owners }
}

/** A seat with no owner of its own counts any owner's SHIFT. */
export function shownOf(seat: Seat, owners: readonly Owner[]): Shown<string, number> {
  return seat.owner?.mode ?? { mode: undefined, page: undefined, shift: owners.some((o) => o.mode.shift) }
}

/** `seat`'s bank on `shift`'s layer now; undefined while its pad mode or page is unknown. */
export function showing(seat: Seat, shown: Shown<string, number>, shift: boolean): object | undefined {
  const fits = (b: Bank) => b.shift === shift && (b.mode === undefined || b.mode === shown.mode) && (b.page === undefined || b.page === shown.page)
  const view = seat.banks.find(fits)?.view
  return view ?? (seat.banked || shift ? undefined : seat.control)
}
