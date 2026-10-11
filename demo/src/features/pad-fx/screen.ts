// Concern: one deck's PAD FX on the page: unconnected, PAD FX1/2 and 16 pads held to apply, lit as the FLX10's; connected, the page showing | Non-concern: the rules, the audio | IO: deck fx <-> DOM
import { palette } from 'dj-controller'
import { make, mount } from '../../shared/dom.ts'
import { MODEL } from '../../shared/flx10.ts'
import { holdable } from '../../shared/holdable.ts'
import { logger } from '../../shared/logger.ts'
import type { ScreenShift } from '../../shared/screen-shift.ts'
import { createStore, type Watched } from '../../shared/store.ts'
import { unlessRefused, type DeckFx } from './actions.ts'
import { NAMES, slotAt, slotOf, timingText } from './banks.ts'
import type { Shown } from './hardware.ts'
import { isOn } from './hold.ts'
import { EFFECT_COLOURS } from './lights.ts'

const labelOf = (slot: number): string => {
  const { effect, timing } = slotOf(slot)
  return `${NAMES[effect]} ${timingText(timing)}`.trim()
}

type Rgb = (slot: number) => string | undefined

/** Each slot's effect colour as the pads show it, once the model palette loads; a failed load logged and the stylesheet's pad kept. */
async function coloursOf(signal: AbortSignal): Promise<Rgb | null> {
  try {
    const colours = await palette(MODEL)
    return signal.aborted ? null : (slot) => colours.colour(EFFECT_COLOURS[slotOf(slot).effect])?.rgb
  } catch (err) {
    logger.error('the PAD FX colours did not load', err)
    return null
  }
}

function light(element: HTMLElement, slot: number, on: boolean, rgb: Rgb | null): void {
  element.dataset.on = String(on)
  const colour = rgb?.(slot)
  if (colour !== undefined) element.style.setProperty('--fx', colour)
}

/** MAN p.80: rekordbox's deck screen shows the Pad FX of the page showing. */
export function showPadFxDisplay(section: HTMLElement, fx: DeckFx, shown: Watched<Shown>, signal: AbortSignal): Promise<void> {
  const cells = Array.from({ length: 8 }, () => make('span', { className: 'pad-fx-name' }))
  const display = make('div', { className: 'pad-fx-display' }, ...cells)
  mount(section, signal, display)
  const slotFor = (pad: number): number => {
    const s = shown.state
    return s === null ? slotAt(0, 0, pad) : slotAt(s.bank, s.page, pad)
  }
  let rgb: Rgb | null = null
  const show = () => {
    display.hidden = shown.state === null
    cells.forEach((cell, pad) => {
      cell.textContent = labelOf(slotFor(pad))
      light(cell, slotFor(pad), isOn(fx.holding.state, slotFor(pad)), rgb)
    })
  }
  shown.watch(show, signal)
  fx.holding.watch(show, signal)
  return coloursOf(signal).then((loaded) => {
    rgb = loaded
    show()
  })
}

/** Without a controller: PAD FX1 and PAD FX2 choose the bank, its pages a row each; SHIFT+pad does nothing, as on the FLX10. */
export function showPadFx(section: HTMLElement, fx: DeckFx, shift: ScreenShift, signal: AbortSignal): Promise<void> {
  const bank = createStore(0)
  const banks = [0, 1].map((b) => make('button', { type: 'button', textContent: `PAD FX${b + 1}` }))
  const pads = Array.from({ length: 16 }, () => make('button', { className: 'pad', type: 'button' }))
  const slotFor = (i: number): number => slotAt(bank.state, Math.floor(i / 8), i % 8)
  mount(section, signal, make('div', { className: 'pad-fx' }, make('div', { className: 'pad-fx-banks', role: 'group', ariaLabel: 'pad fx bank' }, ...banks), make('div', { className: 'pad-fx-pads', role: 'group', ariaLabel: 'pad fx' }, ...pads)))
  banks.forEach((button, b) => button.addEventListener('click', () => bank.update(() => b), { signal }))
  pads.forEach((button, i) => {
    let letGo: (() => void) | null = null
    holdable(
      button,
      (_, key) => {
        if (!shift.take(key)) letGo = unlessRefused(() => fx.hold(slotFor(i)))
      },
      () => {
        letGo?.()
        letGo = null
      },
      signal,
    )
  })
  let rgb: Rgb | null = null
  const show = () => {
    banks.forEach((button, b) => (button.ariaPressed = String(b === bank.state)))
    pads.forEach((button, i) => {
      button.textContent = labelOf(slotFor(i))
      light(button, slotFor(i), isOn(fx.holding.state, slotFor(i)), rgb)
    })
  }
  bank.watch(show, signal)
  fx.holding.watch(show, signal)
  return coloursOf(signal).then((loaded) => {
    rgb = loaded
    show()
  })
}
