// Concern: a deck's renders kept for one render BPM, each asked again resolving at once, another BPM dropping them | Non-concern: rendering | IO: (bpm, semitones) -> channels
export type Channels = Float32Array<ArrayBuffer>[]

type Kept = { readonly made: Promise<Channels>; settled: boolean; waiting: number; readonly stop: AbortController }

/** Each caller gets its own copy, as a lock hands its render to the player. */
export function keptRenders(make: (bpm: number, semitones: number, signal: AbortSignal) => Promise<Channels>): (bpm: number, semitones: number, signal: AbortSignal) => Promise<Channels> {
  let kept: { readonly bpm: number; readonly drop: AbortController; readonly renders: Map<number, Kept> } | null = null
  return async (bpm, semitones, signal) => {
    if (kept?.bpm !== bpm) {
      kept?.drop.abort(new Error(`renders at ${kept.bpm} BPM dropped for ${bpm} BPM`))
      kept = { bpm, drop: new AbortController(), renders: new Map() }
    }
    const { renders, drop } = kept
    signal.throwIfAborted()
    let render = renders.get(semitones)
    if (!render) {
      const stop = new AbortController()
      const made = make(bpm, semitones, AbortSignal.any([drop.signal, stop.signal]))
      render = { made, settled: false, waiting: 0, stop }
      const kept = render
      // Registered before any wait, so it runs first: a wait that ends with the render finds it settled.
      made.then(
        () => (kept.settled = true),
        () => {
          kept.settled = true
          if (renders.get(semitones) === kept) renders.delete(semitones)
        },
      )
      renders.set(semitones, render)
    }
    const { made } = render
    const done = new AbortController()
    render.waiting++
    try {
      const waited = new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true, signal: done.signal }))
      const channels = await Promise.race([made, waited])
      return channels.map((c) => c.slice())
    } finally {
      done.abort()
      render.waiting--
      // Unmade and wanted by no one, as a key stepped past: stopped, not kept.
      if (!render.settled && render.waiting === 0 && renders.get(semitones) === render) {
        renders.delete(semitones)
        render.stop.abort(new Error(`no one waits for the render at ${bpm} BPM, ${semitones} semitones`))
      }
    }
  }
}
