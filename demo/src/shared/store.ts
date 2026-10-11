// Concern: one piece of state, its one writer, its readers told of each change, and values derived from states | Non-concern: what the state is | IO: (change) -> watchers
export type Watched<S> = {
  readonly state: S
  /** Calls `seen` now and after each change. */
  watch(seen: (state: S) => void, signal: AbortSignal): void
}

export type Store<S> = Watched<S> & {
  update(change: (state: S) => S): void
}

export function createStore<S>(initial: S): Store<S> {
  let state = initial
  const watchers = new Set<(state: S) => void>()
  return {
    get state() {
      return state
    },
    update(change) {
      const next = change(state)
      if (next === state) return
      state = next
      for (const seen of watchers) seen(state)
    },
    watch(seen, signal) {
      if (signal.aborted) return
      watchers.add(seen)
      signal.addEventListener('abort', () => watchers.delete(seen), { once: true })
      seen(state)
    },
  }
}

/** The state now and after changes, those made while the reader is busy yielded once. */
export async function* changes<S>(store: Watched<S>, signal: AbortSignal): AsyncGenerator<S> {
  let changed = false
  let wake = (): void => {}
  store.watch(() => {
    changed = true
    wake()
  }, signal)
  signal.addEventListener('abort', () => wake(), { once: true })
  while (!signal.aborted) {
    if (!changed) await new Promise<void>((resolve) => (wake = resolve))
    if (signal.aborted) return
    changed = false
    yield store.state
  }
}

export function derived<T>(compute: () => T, sources: readonly Watched<unknown>[]): Watched<T> {
  return {
    get state() {
      return compute()
    },
    watch(seen, signal) {
      let last: { readonly value: T } | null = null
      const check = () => {
        const value = compute()
        if (last?.value === value) return
        last = { value }
        seen(value)
      }
      for (const source of sources) source.watch(check, signal)
    },
  }
}
