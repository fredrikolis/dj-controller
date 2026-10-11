// Concern: one deck's key on the page, any pending shown; without a controller −/KEY SYNC/+, KEY RESET, KEY SHIFT, KEYBOARD, 16 pads as the FLX10's pages | Non-concern: the rules | IO: deck <-> DOM
import { palette } from 'dj-controller'
import { make, mount } from '../../shared/dom.ts'
import { MODEL } from '../../shared/flx10.ts'
import { logger } from '../../shared/logger.ts'
import { pressable } from '../../shared/pressable.ts'
import type { ScreenShift } from '../../shared/screen-shift.ts'
import { createStore } from '../../shared/store.ts'
import { slotName } from '../../shared/transport/hot-cue-state.ts'
import { pendingShift } from '../../shared/transport/lock.ts'
import { CUE_COLOUR, LOOP_COLOUR } from '../../shared/hot-cues/lights.ts'
import { slotOf } from '../../shared/hot-cues/hot-cue.ts'
import type { KeyShift } from './actions.ts'
import { renderAhead } from './ahead.ts'
import { chosenCue, PAD_PITCHES } from './semitones.ts'
import { jogScreenKey, PITCH_COLOURS, pitchKind, signed } from './lights.ts'

/** The key as the jog screen shows it (MAN p.33 items 3-4), and a key asked, dim until its render plays. */
export function showKey(section: HTMLElement, keys: KeyShift, signal: AbortSignal): void {
  const { deck } = keys
  const key = make('span')
  const change = make('span', { className: 'key-change' })
  const pending = make('span', { className: 'pending', hidden: true })
  mount(section, signal, make('output', { className: 'key', ariaLabel: 'key' }, key, change, pending))
  keys.watch(() => {
    const s = deck.state.state
    const shown = jogScreenKey(s, deck.song.key)
    const asked = pendingShift(s, keys.asked())
    key.textContent = shown.key
    change.textContent = shown.change
    pending.hidden = asked === null
    pending.textContent = asked === null ? '' : signed(asked)
  }, signal)
}

type Mode = 'keyShift' | 'keyboard'

/** Without a controller: rekordbox's semitone −/+ and KEY SYNC (RB p.129 items 4-6), KEY RESET (p.131 item 13), the two pad modes on 16 pads. */
/** Its pads' area, for `paintKeys`, and the renders ahead's work. */
export function showKeyControls(section: HTMLElement, keys: KeyShift, shift: ScreenShift, signal: AbortSignal): { readonly area: HTMLElement; readonly ahead: Promise<void> } {
  const { deck } = keys
  const button = (textContent: string, ariaLabel?: string) => make('button', { type: 'button', textContent, ...(ariaLabel ? { ariaLabel } : {}) })
  const down = button('−', 'semitone down')
  const sync = button('KEY SYNC')
  const up = button('+', 'semitone up')
  const reset = button('KEY RESET')
  const keyShiftMode = button('KEY SHIFT')
  const keyboardMode = button('KEYBOARD')
  // Pages side by side, each laid out as the FLX10's: pads 1-4 over 5-8 (MAN p.86).
  const pads = PAD_PITCHES.map((pitches, page) => pitches.map((pitch, pad) => ({ page, pad, pitch, button: make('button', { className: 'pad', type: 'button' }) })))
  const area = make('div', { className: 'key-pads' }, ...pads.map((page, p) => make('div', { className: 'key-page', role: 'group', ariaLabel: `page ${p + 1}` }, ...page.map((pad) => pad.button))))
  mount(section, signal, make('div', { className: 'key-buttons', role: 'group', ariaLabel: 'key' }, down, sync, up, reset, keyShiftMode, keyboardMode), area)
  const mode = createStore<Mode>('keyShift')
  const pitches = createStore<readonly number[]>([])
  pressable(down, () => keys.step(-1), signal)
  pressable(up, () => keys.step(1), signal)
  pressable(sync, (_, key) => (shift.take(key) ? keys.reset() : keys.keySync()), signal)
  pressable(reset, () => keys.reset(), signal)
  pressable(keyShiftMode, () => mode.update(() => 'keyShift'), signal)
  pressable(keyboardMode, () => {
    mode.update(() => 'keyboard')
    keys.chooseAgain()
  }, signal)
  for (const { page, pad, button: b } of pads.flat()) {
    // ASSUMPTION: SHIFT+pad does nothing, as on the FLX10.
    pressable(b, (time, key) => (shift.take(key) ? undefined : mode.state === 'keyShift' ? keys.shiftPad(page, pad) : keys.keyboardPad(page, pad, time)), signal)
  }
  const show = () => {
    const s = deck.state.state
    const choosing = mode.state === 'keyboard' && chosenCue(keys.chosen.state, s.hotCues) === null
    const asked = keys.asked()
    pitches.update(() => (choosing ? [] : [...new Set(PAD_PITCHES.flat())]))
    sync.ariaPressed = String(s.keySync)
    keyShiftMode.ariaPressed = String(mode.state === 'keyShift')
    keyboardMode.ariaPressed = String(mode.state === 'keyboard')
    for (const b of [down, sync, up, reset]) b.disabled = !s.loaded
    for (const { page, pad, pitch, button: b } of pads.flat()) {
      const slot = slotOf(page, pad)
      const cue = s.hotCues[slot]
      b.textContent = choosing ? slotName(slot) : signed(pitch)
      b.dataset.light = choosing ? (cue?.kind ?? 'empty') : pitchKind(pitch)
      b.dataset.on = String(!choosing && pitch === asked)
      b.disabled = !s.loaded
    }
  }
  keys.watch(show, signal)
  mode.watch(show, signal)
  return { area, ahead: renderAhead(deck, pitches, signal) }
}

/** The pads' colours as the FLX10 lights them, once the model palette loads; never rejects, a failed load logged. */
export async function paintKeys(areas: readonly HTMLElement[], signal: AbortSignal): Promise<void> {
  try {
    const colours = await palette(MODEL)
    if (signal.aborted) return
    const tokens = [['--zero', PITCH_COLOURS.zero], ['--up', PITCH_COLOURS.up], ['--down', PITCH_COLOURS.down], ['--cue', CUE_COLOUR], ['--hot-loop', LOOP_COLOUR]] as const
    for (const [token, colour] of tokens) {
      const rgb = colours.colour(colour)?.rgb
      if (rgb !== undefined) areas.forEach((area) => area.style.setProperty(token, rgb))
    }
  } catch (err) {
    logger.error('the key shift colours did not load', err)
  }
}
