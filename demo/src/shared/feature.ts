// Concern: what every feature takes: the desk, the controller, connected or virtual, its text on the twin, the signal its work ends with | Non-concern: any feature's work | IO: none
import type { Desk } from './engine/engine.ts'
import type { Flx10 } from './flx10.ts'
import type { TwinText } from './twin-text.ts'

/** Once per controller: the page plays nothing but one, the virtual FLX10 until a real one connects; all its work ends when `signal` aborts. */
export type FeatureHandles = { readonly desk: Desk; readonly controller: Flx10; readonly text: TwinText; readonly signal: AbortSignal }

/** Settles once its streams end, at the latest when `signal` aborts or the controller closes; rejects with the first stream that failed. */
export type Feature = (handles: FeatureHandles) => Promise<void>
