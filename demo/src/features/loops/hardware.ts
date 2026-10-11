// Concern: one deck's loops on the FLX10: loop buttons, SHIFT layers and Beat Loop pads in; LEDs and pad colours out | Non-concern: the rules (loop.ts), what lights (lights.ts) | IO: controls <-> deck
import type { LedButton } from 'dj-controller'
import type { Flx10Deck } from '../../shared/flx10.ts'
import { ledOut, padOut, showLights, type Blink, type Plan, type Steady } from '../../shared/lights/show-lights.ts'
import { changes, createStore } from '../../shared/store.ts'
import { activeLoop } from '../../shared/memory-cues/actions.ts'
import { activeLoopLit } from '../../shared/memory-cues/memory-cue.ts'
import { follow } from '../../shared/streams.ts'
import type { Deck } from '../../shared/transport/deck.ts'
import { gridOf } from '../../shared/transport/grid.ts'
import { adjustIn, beatLoop, fourBeatExit, loopIn, loopOut, quantize, reloop } from './actions.ts'
import { BLINK, FAST, lightsOf, PAD_BLINK, PAD_COLOUR, type Light, type Lights } from './lights.ts'
import { PAD_BEATS } from './loop.ts'

function planOf(controls: Flx10Deck, lights: Lights, activeLooping: boolean): Plan {
  const steady: Steady[] = []
  const blinks: Blink[] = []
  const led = (name: string, button: LedButton<unknown>, light: Light | boolean) => {
    const out = ledOut(button)
    if (light === 'blink' || light === 'fast') blinks.push({ kind: 'led', name: `${name} ${light}`, out, pattern: light === 'fast' ? FAST : BLINK })
    else steady.push({ kind: 'led', out, value: light === true || light === 'on' })
  }
  // MML D21 9n 35, D14 9n 10, D15 9n 11, D16 9n 14.
  led('quantize', controls.quantize, lights.quantize)
  led('loop-in', controls.loopIn, lights.loopIn)
  led('loop-out', controls.loopOut, lights.loopOut)
  led('exit', controls['4BeatExit'], lights.exit)
  // The SHIFT layers: 9n 4D, 4C, 50 (MML D14-D16).
  led('reloop', controls.shifted.loopOut, lights.reloop)
  led('adjust-in', controls.shifted.loopIn, false)
  led('active-loop', controls.shifted['4BeatExit'], activeLooping)
  const { mode, page } = controls.mode
  if (mode === 'beatLoop' && page !== undefined) {
    controls.modes.beatLoop.pages[page].pads.forEach((pad, i) => {
      const out = padOut(pad)
      if (PAD_BEATS[page]?.[i] === lights.beats) blinks.push({ kind: 'pad', name: `pad ${page} ${i}`, out, pattern: PAD_BLINK })
      else steady.push({ kind: 'pad', out, value: PAD_COLOUR })
    })
  }
  return { steady, blinks }
}

function keepLights(controls: Flx10Deck, deck: Deck, signal: AbortSignal): Promise<void>[] {
  const show = showLights(signal)
  const grid = gridOf(deck)
  const seen = createStore(0)
  const bump = () => seen.update((n) => n + 1)
  deck.state.watch(bump, signal)
  return [
    follow(controls.modeChanges({ signal }), bump, signal),
    follow(changes(seen, signal), () => show(planOf(controls, lightsOf(deck.state.state, grid), activeLoopLit(deck.state.state))), signal),
  ]
}

export function playLoops(controls: Flx10Deck, deck: Deck, signal: AbortSignal): Promise<void>[] {
  // SHIFT+4 BEAT/EXIT switches a memory loop's Active Loop (MAN p.22); SHIFT+QUANTIZE, TAP, is master tempo's.
  return [
    follow(controls.quantize.presses({ signal }), (press) => (press.shift ? undefined : quantize(deck)), signal),
    follow(controls.loopIn.presses({ signal }), (press) => (press.shift ? adjustIn(deck) : loopIn(deck, press.time)), signal),
    follow(controls.loopOut.presses({ signal }), (press) => (press.shift ? reloop(deck, press.time) : loopOut(deck, press.time)), signal),
    follow(controls['4BeatExit'].presses({ signal }), (press) => (press.shift ? activeLoop(deck, press.time) : fourBeatExit(deck, press.time)), signal),
    // MML P1-P8: 9p 60-6F.
    ...controls.pads.map((pad) =>
      follow(
        pad.hits({ signal }),
        (hit) => {
          const beats = PAD_BEATS[hit.page]?.[hit.pad]
          if (hit.mode === 'beatLoop' && !hit.shift && beats !== undefined) beatLoop(deck, beats, hit.time)
        },
        signal,
      ),
    ),
    ...keepLights(controls, deck, signal),
  ]
}
