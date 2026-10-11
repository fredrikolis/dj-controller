// Concern: a range input bound to one number of a store: moving it writes, each change of the store shows | Non-concern: what the number means | IO: (input, store) -> writes; state -> value
import type { Watched } from './store.ts'

/** Binds `input` to what `read` takes from `store`, its moves written through `write`, until `signal` aborts. */
export function bindRange<S>(input: HTMLInputElement, store: Watched<S>, read: (state: S) => number, write: (value: number) => void, signal: AbortSignal): void {
  input.addEventListener('input', () => write(input.valueAsNumber), { signal })
  store.watch((state) => {
    const value = read(state)
    if (input.valueAsNumber !== value) input.valueAsNumber = value
  }, signal)
}
