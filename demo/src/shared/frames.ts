// Concern: the page's animation frames as an async stream, ending quietly when its signal aborts | Non-concern: what a frame draws or writes | IO: (signal) -> AsyncIterable<void>
export async function* frames(signal: AbortSignal): AsyncGenerator<void> {
  let wake = (): void => {}
  let id = 0
  const stop = () => {
    cancelAnimationFrame(id)
    wake()
  }
  signal.addEventListener('abort', stop, { once: true })
  try {
    while (!signal.aborted) {
      await new Promise<void>((resolve) => {
        wake = resolve
        id = requestAnimationFrame(() => resolve())
      })
      if (signal.aborted) return
      yield
    }
  } finally {
    signal.removeEventListener('abort', stop)
  }
}
