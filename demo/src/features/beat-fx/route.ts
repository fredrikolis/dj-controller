// Concern: the Beat FX unit on the mixer's FX point its target names, the others passed straight on | Non-concern: the unit, the mixer's points | IO: (target) -> gains
import type { Insert } from '../../shared/engine/engine.ts'
import type { FxPoint, FxPoints } from '../../shared/mixer/mixer.ts'
import { pointFor, type Target } from './effects.ts'

type Routed = { readonly point: FxPoint; readonly send: GainNode; readonly back: GainNode }

const FADE_SECONDS = 0.02

function fade(param: AudioParam, to: number, ctx: BaseAudioContext): void {
  const now = ctx.currentTime
  param.cancelScheduledValues(now)
  param.setValueAtTime(param.value, now)
  param.linearRampToValueAtTime(to, now + FADE_SECONDS)
}

/** `route` moves `unit` to the target's point, the point left passed straight on; one point joined at a time, as the master's holds every other's sound. */
export function createRouter(ctx: BaseAudioContext, points: FxPoints, unit: Insert, signal: AbortSignal): (target: Target) => void {
  const routed: Routed[] = [...points.channels, points.sampler, points.master].map((point) => ({ point, send: new GainNode(ctx, { gain: 0 }), back: new GainNode(ctx, { gain: 0 }) }))
  let wanted: Routed | null = null
  let joined: Routed | null = null
  let pending: ReturnType<typeof setTimeout> | undefined
  const leave = (r: Routed) => {
    r.point.input.disconnect(r.send)
    r.send.disconnect()
    unit.output.disconnect(r.back)
    r.back.disconnect()
    r.point.through.cancelScheduledValues(ctx.currentTime)
    r.point.through.value = 1
  }
  const join = () => {
    if (signal.aborted) return
    if (joined !== null && joined !== wanted) leave(joined)
    if (wanted !== null) {
      if (joined !== wanted) {
        wanted.point.input.connect(wanted.send).connect(unit.input)
        unit.output.connect(wanted.back).connect(wanted.point.output)
      }
      for (const gain of [wanted.send.gain, wanted.back.gain]) fade(gain, 1, ctx)
      fade(wanted.point.through, 0, ctx)
    }
    joined = wanted
  }
  signal.addEventListener(
    'abort',
    () => {
      clearTimeout(pending)
      if (joined) leave(joined)
    },
    { once: true },
  )
  return (target) => {
    clearTimeout(pending)
    const chosen = pointFor(points, target)
    wanted = routed.find((r) => r.point === chosen) ?? null
    if (joined === null || joined === wanted) return join()
    for (const gain of [joined.send.gain, joined.back.gain]) fade(gain, 0, ctx)
    fade(joined.point.through, 1, ctx)
    pending = setTimeout(join, FADE_SECONDS * 2000)
  }
}
