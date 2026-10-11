// Concern: one deck's loops on the page: the loop over the song, its beats, and without a controller its buttons and 16 pads, lit as the FLX10's | Non-concern: the rules (loop.ts) | IO: deck <-> DOM
import { make, mount } from '../../shared/dom.ts'
import { frames } from '../../shared/frames.ts'
import { activeLoop } from '../../shared/memory-cues/actions.ts'
import { activeLoopLit } from '../../shared/memory-cues/memory-cue.ts'
import { pressable } from '../../shared/pressable.ts'
import type { ScreenShift } from '../../shared/screen-shift.ts'
import type { DeckState } from '../../shared/transport/deck-state.ts'
import type { Deck } from '../../shared/transport/deck.ts'
import { gridOf, type Grid } from '../../shared/transport/grid.ts'
import { adjustIn, beatLoop, fourBeatExit, loopIn, loopOut, quantize, reloop } from './actions.ts'
import { lightsOf, type Lights } from './lights.ts'
import { beatsOf, PAD_BEATS } from './loop.ts'

const beatsText = (beats: number): string => (beats < 1 && Number.isInteger(1 / beats) ? `1/${1 / beats}` : String(Math.round(beats * 100) / 100))

const percent = (frame: number, grid: Grid): string => `${(100 * Math.min(Math.max(frame, 0), grid.end)) / grid.end}%`

/** The loop over the song, a pending in point and the playhead, moved each frame until `signal` aborts. */
async function showStrip(strip: HTMLElement, deck: Deck, signal: AbortSignal): Promise<void> {
  const grid = gridOf(deck)
  const region = make('span', { className: 'region' })
  const pending = make('span', { className: 'pending' })
  const head = make('span', { className: 'head' })
  strip.append(region, pending, head)
  deck.state.watch(({ loop }) => {
    region.hidden = loop.stored === null
    region.classList.toggle('active', loop.active)
    region.style.setProperty('--in', percent(loop.stored?.in ?? 0, grid))
    region.style.setProperty('--out', percent(loop.stored?.out ?? 0, grid))
    pending.hidden = loop.pending === null || loop.active
    pending.style.setProperty('--at', percent(loop.pending ?? 0, grid))
  }, signal)
  for await (const _ of frames(signal)) head.style.setProperty('--at', percent(deck.position, grid))
}

/** The FLX10's SHIFT layers: RELOOP on LOOP OUT, Active Loop on 4 BEAT/EXIT, ADJUST dark. */
const shiftedLights = (lights: Lights, activeLooping: boolean): Lights => ({ ...lights, loopIn: 'off', loopOut: lights.reloop ? 'on' : 'off', exit: activeLooping })

function showControls(controls: HTMLElement, deck: Deck, shift: ScreenShift, signal: AbortSignal): void {
  const grid = gridOf(deck)
  const button = (className: string, textContent: string) => make('button', { className, type: 'button', textContent })
  const quantizeButton = button('quantize', 'QUANTIZE')
  const inButton = button('loop-in', 'LOOP IN 1/2X')
  const outButton = button('loop-out', 'LOOP OUT 2X')
  const exitButton = button('exit', '4 BEAT/EXIT')
  const pads = PAD_BEATS.flatMap((page) => page.map((beats) => ({ beats, pad: button('pad', beatsText(beats)) })))
  const padGroup = make('div', { className: 'beat-loop', role: 'group', ariaLabel: 'beat loop' }, ...pads.map((p) => p.pad))
  controls.append(quantizeButton, inButton, outButton, exitButton, padGroup)
  const show = (s: DeckState) => {
    const unshifted = lightsOf(s, grid)
    const lights = shift.state ? shiftedLights(unshifted, activeLoopLit(s)) : unshifted
    quantizeButton.ariaPressed = String(lights.quantize)
    inButton.dataset.light = lights.loopIn
    outButton.dataset.light = lights.loopOut
    exitButton.dataset.light = lights.exit ? 'on' : 'off'
    for (const { beats, pad } of pads) {
      pad.ariaPressed = String(beats === unshifted.beats)
      pad.dataset.light = beats === unshifted.beats ? 'blink' : 'off'
    }
    for (const b of [inButton, outButton, exitButton, ...pads.map((p) => p.pad)]) b.disabled = !s.loaded
  }
  pressable(quantizeButton, (_, key) => (shift.take(key) ? undefined : quantize(deck)), signal)
  pressable(inButton, (time, key) => (shift.take(key) ? adjustIn(deck) : loopIn(deck, time)), signal)
  pressable(outButton, (time, key) => (shift.take(key) ? reloop(deck, time) : loopOut(deck, time)), signal)
  pressable(exitButton, (time, key) => (shift.take(key) ? activeLoop(deck, time) : fourBeatExit(deck, time)), signal)
  for (const { beats, pad } of pads) pressable(pad, (time, key) => (shift.take(key) ? undefined : beatLoop(deck, beats, time)), signal)
  deck.state.watch(show, signal)
  shift.watch(() => show(deck.state.state), signal)
}

/** Deck `deck`'s loop in `section`, and with `shift` its loop buttons and pads, until `signal` aborts. */
export async function showLoops(section: HTMLElement, deck: Deck, shift: ScreenShift | null, signal: AbortSignal): Promise<void> {
  const strip = make('div', { className: 'loop-strip' })
  strip.ariaHidden = 'true'
  const beats = make('output', { className: 'loop-beats', ariaLabel: 'loop beats' })
  const grid = gridOf(deck)
  const area = make('div', { className: 'loops' }, strip, beats)
  mount(section, signal, area)
  deck.state.watch(({ loop }) => {
    beats.hidden = !loop.active || loop.stored === null
    beats.textContent = loop.stored ? beatsText(beatsOf(loop.stored, grid)) : ''
  }, signal)
  if (shift) showControls(area, deck, shift, signal)
  await showStrip(strip, deck, signal)
}
