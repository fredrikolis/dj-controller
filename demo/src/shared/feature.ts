// Concern: what every feature takes: the desk, the controller or else each deck's on-screen SHIFT, where its controls go, the signal its work ends with | Non-concern: any feature's work | IO: none
import type { Desk } from './engine/engine.ts'
import type { Pair } from './decks.ts'
import type { Flx10 } from './flx10.ts'
import type { ScreenShift } from './screen-shift.ts'

export type DeskView = { readonly decks: Pair<HTMLElement>; readonly mixer: HTMLElement; readonly effects: HTMLElement; readonly sampler: HTMLElement }

/** Once per connection state: with no controller, on-screen controls play the desk; all its work ends when `signal` aborts. */
export type FeatureHandles = {
  readonly desk: Desk
  readonly view: DeskView
  readonly signal: AbortSignal
} & ({ readonly controller: Flx10; readonly shifts: null } | { readonly controller: null; readonly shifts: Pair<ScreenShift> })

/** Settles once its streams end, at the latest when `signal` aborts or the controller closes; rejects with the first stream that failed. */
export type Feature = (handles: FeatureHandles) => Promise<void>
