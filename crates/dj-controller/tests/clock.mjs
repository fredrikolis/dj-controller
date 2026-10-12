// Concern: a clock a boundary test owns, given as `options.clock`: time stands still but while `until` passes it, straight to each wait in turn | Non-concern: what waits on it (the driver) | IO: (waits) -> resolved in order
/** A clock whose time moves only inside `until`; `waiting` counts the waits it holds. */
export function testClock() {
  let now = 0
  const waits = new Set()
  return {
    now: () => now,
    sleep: (ms, signal) =>
      new Promise((resolve, reject) => {
        const wait = { at: now + ms, resolve }
        waits.add(wait)
        signal.addEventListener('abort', () => (waits.delete(wait), reject(signal.reason)), { once: true })
      }),
    get waiting() {
      return waits.size
    },
    /** `promise`, time passed to the earliest wait each turn nothing else is left to run, until it settles. */
    async until(promise) {
      let settled = false
      const settle = () => (settled = true)
      promise.then(settle, settle)
      for (;;) {
        await new Promise(setImmediate)
        if (settled) return promise
        const [next] = [...waits].sort((a, b) => a.at - b.at)
        if (!next) continue
        waits.delete(next)
        now = next.at
        next.resolve()
      }
    },
  }
}
