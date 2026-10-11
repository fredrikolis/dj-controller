// Concern: the Beat FX panel on the page: the display, the Release FX type and beats; unconnected, every control of the FLX10's section, SHIFT read | Non-concern: the rules, the audio | IO: unit <-> DOM
import { BEATS, beatsText } from '../../shared/fx/beats.ts'
import type { Pair } from '../../shared/decks.ts'
import { make, mount } from '../../shared/dom.ts'
import { holdable } from '../../shared/holdable.ts'
import { pressable } from '../../shared/pressable.ts'
import { bindRange } from '../../shared/range.ts'
import type { ScreenShift } from '../../shared/screen-shift.ts'
import { unlessRefused, type BeatFxControls } from './actions.ts'
import { EFFECTS, NAMES, RELEASE_NAMES, RELEASES, TARGET_LABELS, TARGETS, type BeatFx, type ReleaseFx } from './effects.ts'
import { displayOf } from './unit-state.ts'

const option = (value: string, text: string) => make('option', { value, textContent: text })

const isEffect = (value: string): value is BeatFx => EFFECTS.some((e) => e === value)
const isRelease = (value: string): value is ReleaseFx => RELEASES.some((r) => r === value)

/** MAN p.92's display, the ON state, and rekordbox's Release FX type and beats (RB p.142 items 7, 13), which the FLX10 has no control for. */
function showDisplay(section: HTMLElement, fx: BeatFxControls, signal: AbortSignal): void {
  const name = make('output', { className: 'beat-fx-name' })
  const mode = make('output', { className: 'beat-fx-mode' })
  const bpm = make('output', { className: 'beat-fx-bpm' })
  const channel = make('output', { className: 'beat-fx-channel' })
  const parameter = make('output', { className: 'beat-fx-parameter' })
  const display = make('div', { className: 'beat-fx-display', role: 'group', ariaLabel: 'beat fx display' }, name, mode, bpm, channel, parameter)
  const releaseType = make('select', { ariaLabel: 'release fx' }, ...RELEASES.map((r) => option(r, RELEASE_NAMES[r])))
  const releaseBeats = make('select', { ariaLabel: 'release fx beats' }, ...BEATS.map((b) => option(String(b), beatsText(b))))
  const release = make('label', { className: 'beat-fx-release' }, 'RELEASE FX', releaseType, releaseBeats)
  const head = make('div', { className: 'beat-fx-head' }, display, release)
  mount(section, signal, head)
  releaseType.addEventListener(
    'change',
    () => {
      const type = releaseType.value
      if (isRelease(type)) unlessRefused(() => fx.releaseType(type))
    },
    { signal },
  )
  releaseBeats.addEventListener('change', () => unlessRefused(() => fx.releaseBeats(Number(releaseBeats.value))), { signal })
  const show = () => {
    const s = fx.state.state
    const shown = displayOf(s, fx.bpm.state)
    name.value = shown.name
    mode.value = shown.mode
    bpm.value = (shown.bpm / 100).toFixed(1)
    channel.value = shown.channel
    parameter.value = shown.parameter
    display.dataset.on = String(s.on)
    release.dataset.on = String(s.release.held)
    releaseType.value = s.release.type
    releaseBeats.value = String(s.release.beats)
  }
  fx.state.watch(show, signal)
  fx.bpm.watch(show, signal)
}

/** Without a controller: the FLX10's section as rekordbox's panel (RB p.142); SHIFT from the Shift key or either deck's on-screen SHIFT. */
function showControls(section: HTMLElement, fx: BeatFxControls, shifts: Pair<ScreenShift>, signal: AbortSignal): void {
  const shifted = (key: boolean) => [shifts[0].take(key), shifts[1].take(key)].some(Boolean)
  const effect = make('select', { ariaLabel: 'beat fx' }, ...EFFECTS.map((e) => option(e, NAMES[e])))
  const targets = TARGETS.map((t) => make('button', { type: 'button', textContent: TARGET_LABELS[t] }))
  const left = make('button', { type: 'button', textContent: '◀ BEAT', title: 'SHIFT: AUTO' })
  const right = make('button', { type: 'button', textContent: 'BEAT ▶', title: 'SHIFT: TAP' })
  const depth = make('input', { type: 'range', min: '0', max: '1', step: 'any' })
  const onOff = make('button', { type: 'button', className: 'beat-fx-on', textContent: 'ON/OFF', title: 'SHIFT: RELEASE FX' })
  mount(
    section,
    signal,
    make(
      'div',
      { className: 'beat-fx-controls' },
      effect,
      make('div', { className: 'beat-fx-targets', role: 'group', ariaLabel: 'beat fx channel' }, ...targets),
      make('div', { className: 'beat-fx-beats', role: 'group', ariaLabel: 'beats' }, left, right),
      make('label', {}, 'LEVEL/DEPTH', depth),
      onOff,
    ),
  )
  effect.addEventListener(
    'change',
    () => {
      const chosen = effect.value
      if (isEffect(chosen)) unlessRefused(() => fx.select(chosen))
    },
    { signal },
  )
  targets.forEach((button, i) => button.addEventListener('click', () => unlessRefused(() => fx.target(TARGETS[i])), { signal }))
  pressable(left, (time, key) => unlessRefused(() => fx.beat(-1, shifted(key), time, 0)), signal)
  pressable(right, (time, key) => unlessRefused(() => fx.beat(1, shifted(key), time, 0)), signal)
  bindRange(depth, fx.state, (s) => s.depth, (d) => unlessRefused(() => fx.depth(d)), signal)
  let letGo: (() => void) | null = null
  holdable(
    onOff,
    (_, key) => {
      if (shifted(key)) letGo = unlessRefused(fx.release)
      else unlessRefused(fx.toggle)
    },
    () => {
      letGo?.()
      letGo = null
    },
    signal,
  )
  fx.state.watch((s) => {
    effect.value = s.effect
    targets.forEach((button, i) => (button.ariaPressed = String(TARGETS[i] === s.target)))
    onOff.ariaPressed = String(s.on)
  }, signal)
}

export function showBeatFx(section: HTMLElement, fx: BeatFxControls, shifts: Pair<ScreenShift> | null, signal: AbortSignal): void {
  showDisplay(section, fx, signal)
  if (shifts !== null) showControls(section, fx, shifts, signal)
}
