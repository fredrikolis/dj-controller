// Concern: the master's peak limiter as arithmetic: every frame kept at or under the ceiling, untouched below it; its registered name | Non-concern: the audio thread | IO: (frames) -> frames

export const LIMITER = 'master-limiter'
export const LIMITER_CHANNELS = 2

// The FLX10's MASTER LIMITER, on (MAN p.111, p.156); ASSUMPTION: -1 dBFS, 5 ms ahead, 150 ms release.
export const CEILING = 10 ** (-1 / 20)
const LOOKAHEAD_SECS = 0.005
const RELEASE_SECS = 0.15

export type Limiter = {
  readonly delay: number
  process(channels: readonly Float32Array[]): void
}

export function createLimiter(sampleRate: number, channelCount: number): Limiter {
  const length = Math.max(2, Math.round(LOOKAHEAD_SECS * sampleRate))
  const release = Math.exp(-1 / (RELEASE_SECS * sampleRate))
  const delayed = Array.from({ length: channelCount }, () => new Float32Array(length))
  const held = new Float64Array(length).fill(1)
  // Each gain averaged at frame m's output is a minimum over a window holding m: none passes m's own.
  const deque = new Float64Array(length)
  const gains = new Float64Array(length).fill(1)
  let head = 0
  let tail = 0
  let frame = 0
  let envelope = 1
  let sum = length
  return {
    delay: length - 1,
    process(channels) {
      const frames = channels[0]?.length ?? 0
      for (let i = 0; i < frames; i++) {
        let peak = 0
        for (const c of channels) peak = Math.max(peak, Math.abs(c[i] ?? 0))
        const needed = peak > CEILING ? CEILING / peak : 1
        envelope = Math.min(needed, 1 - (1 - envelope) * release)
        if (tail > head && (deque[head % length] ?? 0) <= frame - length) head++
        const slot = frame % length
        gains[slot] = envelope
        while (tail > head && (gains[(deque[(tail - 1) % length] ?? 0) % length] ?? 1) >= envelope) tail--
        deque[tail % length] = frame
        tail++
        const minimum = gains[(deque[head % length] ?? 0) % length] ?? 1
        sum += minimum - (held[slot] ?? 1)
        held[slot] = minimum
        const gain = Math.min(1, sum / length)
        channels.forEach((c, k) => {
          const ring = delayed[k]
          if (!ring) return
          const late = ring[(frame + 1) % length] ?? 0
          ring[slot] = c[i] ?? 0
          c[i] = late * gain
        })
        frame++
      }
      sum = held.reduce((a, g) => a + g, 0)
    },
  }
}
