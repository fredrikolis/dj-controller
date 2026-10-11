// Concern: a control's stream read until its signal aborts, each item acted on in turn | Non-concern: which control drives what (each feature) | IO: (feed, signal) -> calls
/** Acts on each item of `feed` in turn; ends when `signal` aborts or the feed ends, and rejects with any other failure. */
export async function follow<T>(feed: AsyncIterable<T>, act: (item: T) => void | Promise<void>, signal: AbortSignal): Promise<void> {
  try {
    for await (const item of feed) await act(item)
  } catch (err) {
    if (!signal.aborted) throw err
  }
}

/** Resolves once `promise` settles or `signal` aborts, whichever is first; a press's release, say, when the controller may outlive the reader. */
export async function until(promise: Promise<unknown>, signal: AbortSignal): Promise<void> {
  const done = new AbortController()
  const aborted = new Promise<void>((resolve) => {
    if (signal.aborted) resolve()
    signal.addEventListener('abort', () => resolve(), { signal: done.signal })
  })
  try {
    await Promise.race([promise, aborted])
  } finally {
    done.abort()
  }
}
