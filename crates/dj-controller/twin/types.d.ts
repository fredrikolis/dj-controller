// Concern: the twin's layout types: a part's shape, place and typed controls, a model's layout | Non-concern: placing (layout.ts), any model's layout | IO: none
import type { Absolute, Button, ColourPad, LedButton, Pad, Relative, Switch, TwinDisplays, ValueOut } from '../index.js'

export type Id = { readonly shift?: boolean; readonly deck?: number }

export type Box = readonly [number, number, number, number]

/** A control a part shows, its shifted view, and its deck's in-control switch. */
export type Placed<C> = { readonly control: C; readonly shifted?: C; readonly inControl?: Switch }

type Geometry = { readonly at: readonly [number, number]; readonly size: number | readonly [number, number]; readonly label?: string; readonly name?: string }

export type JogScreen = {
  readonly id: Exclude<keyof TwinDisplays, 'beatFx'>
  readonly deck: string
  readonly bpm: ValueOut
  readonly speed: ValueOut
  readonly minutes: ValueOut
  readonly seconds: ValueOut
  readonly remaining: ValueOut
  readonly key: ValueOut
  readonly keyChange: ValueOut
  readonly masterTempo: ValueOut
  readonly master: ValueOut
  readonly sync: ValueOut
  readonly marker: ValueOut
  readonly cue: ValueOut
  readonly hidden: ValueOut
}

/** One part by its shape; `decks` where a shared control shows only presses naming them. For a virtual controller's hands: `latches`, a SHIFT a click holds; a `spin` turns on `layer`, holding `touch`, `ticks` a revolution where its model states none. */
export type Entry = Geometry &
  (
    | { readonly shape: 'passive' }
    | { readonly shape: 'button' | 'round' | 'touch'; readonly controls: readonly Placed<Button<Id> | LedButton<Id>>[]; readonly decks?: readonly number[]; readonly latches?: boolean }
    | { readonly shape: 'pad'; readonly controls: readonly Placed<Pad<Id> | ColourPad<Id>>[] }
    | { readonly shape: 'fader'; readonly controls: readonly Placed<Absolute>[]; readonly reversed?: boolean }
    | { readonly shape: 'knob'; readonly controls: readonly Placed<Absolute>[] }
    | { readonly shape: 'position'; readonly controls: readonly Placed<Switch>[] }
    | { readonly shape: 'encoder'; readonly controls: readonly Placed<Relative<Id>>[] }
    | { readonly shape: 'spin'; readonly controls: readonly Placed<Relative<Id>>[]; readonly layer?: string; readonly touch?: readonly Button<Id>[]; readonly ticks?: number }
    | { readonly shape: 'selector'; readonly controls: readonly []; readonly positions: readonly { readonly name: string; readonly at: readonly [number, number]; readonly on: Switch }[] }
    | { readonly shape: 'meter'; readonly controls: readonly Placed<ValueOut>[] }
    | { readonly shape: 'jog'; readonly controls: readonly Placed<ValueOut>[]; readonly screens: readonly JogScreen[] }
    | { readonly shape: 'display'; readonly id: 'beatFx'; readonly controls: readonly []; readonly channels: readonly { readonly text: string; readonly on: Switch }[] }
  )

export type Layout = { readonly view: Box; readonly narrow: readonly Box[]; readonly sections: readonly { readonly at: readonly [number, number]; readonly name?: string; readonly parts: readonly Entry[] }[] }

export type Part = Entry & { readonly x: number; readonly y: number; readonly section?: string }
