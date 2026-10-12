// Concern: the Beat FX section on the FLX10: both selectors, BEAT ◀/▶ and SHIFT, LEVEL/DEPTH, ON/OFF and SHIFT in; ON/OFF LEDs out | Non-concern: the rules, what lights | IO: controls <-> unit
import type { Switch } from 'dj-controller'
import { DECKS } from '../../shared/decks.ts'
import type { Flx10 } from '../../shared/flx10.ts'
import { ledOut, showLights } from '../../shared/lights/show-lights.ts'
import { changes } from '../../shared/store.ts'
import { follow, until } from '../../shared/streams.ts'
import { unlessRefused, type BeatFxControls } from './actions.ts'
import { EFFECTS, TARGETS, type BeatFx, type Target } from './effects.ts'
import { planOf } from './lights.ts'
import { START, type BeatFxState } from './unit-state.ts'

type Positions<P extends string> = readonly (readonly [P, Switch])[]

const effectSwitches = (flx: Flx10): Positions<BeatFx> => EFFECTS.map((e) => [e, flx.effect.beatFxSelect[e]])

const targetSwitches = (flx: Flx10): Positions<Target> => {
  const { channels, master, mic, sampler } = flx.effect.beatFxChSelect
  const by: Readonly<Record<Target, Switch>> = { channel1: channels[0], channel2: channels[1], channel3: channels[2], channel4: channels[3], master, mic, sampler }
  return TARGETS.map((t) => [t, by[t]])
}

// flx10-observed.md 2026-10-08: the state reply sends a selector's position alone, as on.
function positionOf<P extends string>(positions: Positions<P>, selector: string): P {
  const on = positions.filter(([, s]) => s.on === true)
  const only = on[0]
  if (on.length !== 1 || only === undefined) throw new Error(`the FLX10 reported ${on.length} positions of ${selector} on (${on.map(([p]) => p).join(', ')}); its state reply names exactly one (MML F13/F14)`)
  return only[0]
}

/** The unit as the FLX10's knobs stand: the effect, the target and LEVEL/DEPTH its state reply gave. */
export function stateOf(flx: Flx10): BeatFxState {
  const level = flx.effect.levelDepth.read()
  if (level === undefined) throw new Error('the FLX10 has not reported BEAT FX LEVEL/DEPTH (MML F15 B4 02); its state reply carries it')
  return { ...START, effect: positionOf(effectSwitches(flx), 'BEAT FX SELECT'), target: positionOf(targetSwitches(flx), 'BEAT FX CH SELECT'), depth: level.value }
}

// flx10-midi.md F13/F14: whether the position left reports off is unverified, so the newest on wins.
function followPositions<P extends string>(positions: Positions<P>, act: (position: P) => void, signal: AbortSignal): Promise<void>[] {
  return positions.map(([position, s]) => follow(s.changes({ signal }), ({ on }) => {
      if (on) unlessRefused(() => act(position))
    }, signal))
}

/** How many PAD FX pads are held on the FLX10's decks now: BEAT ◀/▶ step theirs while any is (RB p.189). */
function padFxHeld(flx: Flx10, signal: AbortSignal): { readonly count: () => number; readonly streams: Promise<void>[] } {
  let held = 0
  const streams = DECKS.flatMap((d) =>
    flx.decks[d].pads.map((pad) =>
      follow(
        pad.hits({ signal }),
        async (hit) => {
          if ((hit.mode !== 'padFx1' && hit.mode !== 'padFx2') || hit.shift) return
          held++
          try {
            await until(hit.released, signal)
          } finally {
            held--
          }
        },
        signal,
      ),
    ),
  )
  return { count: () => held, streams }
}

export function playBeatFx(flx: Flx10, fx: BeatFxControls, signal: AbortSignal): Promise<void>[] {
  const { left, right } = flx.effect.beat
  const pads = padFxHeld(flx, signal)
  const level = flx.effect.levelDepth
  const show = showLights(signal)
  const lights = { onOff: ledOut(flx.effect.beatFxOnOff), release: ledOut(flx.shifted.effect.beatFxOnOff) }
  return [
    ...followPositions(effectSwitches(flx), fx.select, signal),
    ...followPositions(targetSwitches(flx), fx.target, signal),
    follow(level.changes({ signal }), ({ value }) => void unlessRefused(() => fx.depth(value)), signal),
    follow(left.presses({ signal }), (press) => void unlessRefused(() => fx.beat(-1, press.shift, press.time, pads.count())), signal),
    follow(right.presses({ signal }), (press) => void unlessRefused(() => fx.beat(1, press.shift, press.time, pads.count())), signal),
    // MAN p.55 item 8; RB p.185: a Release FX acts while held.
    follow(
      flx.effect.beatFxOnOff.presses({ signal }),
      async (press) => {
        if (!press.shift) return void unlessRefused(fx.toggle)
        const letGo = unlessRefused(fx.release)
        if (letGo === null) return
        try {
          await until(press.released, signal)
        } finally {
          letGo()
        }
      },
      signal,
    ),
    ...pads.streams,
    follow(changes(fx.state, signal), (s) => show(planOf(lights, s)), signal),
  ]
}
