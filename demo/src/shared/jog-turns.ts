// Concern: a jog's motion as turns by the model's revolution, each with the position it came in, the side's by the platter's | Non-concern: what a turn does | IO: positions -> turns
import { follow } from './streams.ts'

type At = { readonly ticks: number }

export type Jog<P extends At = At> = { readonly position: At; positions(options: { signal: AbortSignal }): AsyncIterable<P> }

// A side stating none turns by the platter's: assumed (docs/research/flx10-observed-jog.md).
export function jogRevolutions(jog: { readonly platter: { readonly revolution: number }; readonly side: { readonly revolution: number | undefined } }): { platter: number; side: number } {
  const platter = jog.platter.revolution
  return { platter, side: jog.side.revolution ?? platter }
}

export function followJog<P extends At>(jog: Jog<P>, revolution: number, act: (turns: number, at: P) => void, signal: AbortSignal): Promise<void> {
  let last = jog.position.ticks
  return follow(
    jog.positions({ signal }),
    (at) => {
      act((at.ticks - last) / revolution, at)
      last = at.ticks
    },
    signal,
  )
}
