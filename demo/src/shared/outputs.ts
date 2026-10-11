// Concern: what a feature shows on the controller, written once a frame where it differs from what the device was last told | Non-concern: deciding what to show | IO: (writes) -> awaited outputs
import type { LedButton, ValueOut } from 'dj-controller'
import { frames } from './frames.ts'

export type Write = { readonly out: ValueOut; readonly value: number } | { readonly led: LedButton<unknown>; readonly on: boolean }

const untold = (w: Write): boolean => ('led' in w ? w.led.told !== w.on : w.out.told !== w.value)

const send = (w: Write): Promise<void> => ('led' in w ? w.led.led(w.on) : w.out.set(w.value))

/** Each animation frame, writes what `writes` gives that the device was not told, awaiting them, until `signal` aborts; rejects with a write that failed. */
export async function showEachFrame(writes: () => readonly Write[], signal: AbortSignal): Promise<void> {
  try {
    for await (const _ of frames(signal)) await Promise.all(writes().filter(untold).map(send))
  } catch (err) {
    if (!signal.aborted) throw err
  }
}
