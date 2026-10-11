// Concern: the sampler deck on the page: BANK, 16 slots pressed or held, BPM [-]/[+], SYNC, Q, GAIN; unconnected, SAMPLER VOL in the mixer | Non-concern: the rules, the audio | IO: sampler <-> DOM
import { palette } from 'dj-controller'
import type { Pair } from '../../shared/decks.ts'
import { make, mount } from '../../shared/dom.ts'
import { MODEL } from '../../shared/flx10.ts'
import { holdable } from '../../shared/holdable.ts'
import { logger } from '../../shared/logger.ts'
import { pressable } from '../../shared/pressable.ts'
import { bindRange } from '../../shared/range.ts'
import { BANKS, PADS, POSITIONS, slotAt, type Kind } from '../../shared/sampler/banks.ts'
import { GAIN_RANGE } from '../../shared/sampler/clock.ts'
import type { ScreenShift } from '../../shared/screen-shift.ts'
import type { SamplerDeck } from '../../shared/sampler/sampler-deck.ts'
import { unlessRefused, type Sampler as Controls } from './actions.ts'
import { KIND_COLOURS } from './lights.ts'
import { elsewhereAt, playingAt } from './players.ts'

type Rgb = (kind: Kind) => string | undefined

async function coloursOf(signal: AbortSignal): Promise<Rgb | null> {
  try {
    const colours = await palette(MODEL)
    return signal.aborted ? null : (kind) => colours.colour(KIND_COLOURS[kind])?.rgb
  } catch (err) {
    logger.error('the sampler colours did not load', err)
    return null
  }
}

const toggle = (textContent: string) => make('button', { type: 'button', textContent })

/** Each slot pressed or held as its pad; SHIFT+press stops it (RB p.195), SHIFT from the Shift key or, unconnected, the on-screen SHIFT of the deck whose pads play it (MAN p.84). */
export function showSamplerDeck(section: HTMLElement, sampler: Controls<SamplerDeck>, shifts: Pair<ScreenShift> | null, signal: AbortSignal): Promise<void> {
  const { deck } = sampler
  const banks = Array.from({ length: BANKS }, (_, b) => toggle(`BANK ${b + 1}`))
  const slower = make('button', { type: 'button', textContent: '−', ariaLabel: 'BPM down' })
  const faster = make('button', { type: 'button', textContent: '+', ariaLabel: 'BPM up' })
  const bpm = make('output', { className: 'sampler-bpm' })
  const sync = toggle('BPM SYNC')
  const quantize = toggle('Q')
  const gain = make('input', { type: 'range', min: String(GAIN_RANGE[0]), max: String(GAIN_RANGE[1]), step: '0.5' })
  const slots = Array.from({ length: POSITIONS }, () => make('button', { className: 'sampler-slot', type: 'button' }))
  const sides = [0, 1].map((side) => make('div', { className: 'sampler-side', role: 'group', ariaLabel: `deck ${side + 1} pads` }, ...slots.slice(side * PADS, (side + 1) * PADS)))
  mount(
    section,
    signal,
    make('div', { className: 'sampler-head' }, make('div', { className: 'sampler-banks', role: 'group', ariaLabel: 'bank' }, ...banks), make('div', { className: 'sampler-tempo', role: 'group', ariaLabel: 'sampler BPM' }, slower, bpm, faster), sync, quantize, make('label', {}, 'GAIN', gain)),
    make('div', { className: 'sampler-slots' }, ...sides),
  )
  banks.forEach((button, b) => button.addEventListener('click', () => sampler.bank(b), { signal }))
  pressable(slower, () => sampler.step(-1), signal)
  pressable(faster, () => sampler.step(1), signal)
  sync.addEventListener('click', () => sampler.sync(!deck.state.state.sync), { signal })
  quantize.addEventListener('click', () => sampler.quantize(!deck.state.state.quantize), { signal })
  bindRange(gain, deck.state, (s) => s.gain, sampler.gain, signal)
  slots.forEach((button, position) => {
    let letGo: (() => void) | null = null
    const shift = shifts?.[position < PADS ? 0 : 1]
    holdable(
      button,
      (_, key) => {
        letGo = unlessRefused(() => sampler.press(position, shift ? shift.take(key) : key))
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
    const s = deck.state.state
    banks.forEach((button, b) => (button.ariaPressed = String(b === s.bank)))
    sync.ariaPressed = String(s.sync)
    quantize.ariaPressed = String(s.quantize)
    slower.disabled = faster.disabled = s.sync
    slots.forEach((button, position) => {
      const slot = slotAt(s.bank, position)
      button.textContent = slot?.name ?? ''
      const ready = slot !== null && deck.sounds.state.has(slot.node)
      button.disabled = !ready
      button.ariaBusy = String(slot !== null && !ready)
      button.dataset.mode = slot?.mode ?? ''
      button.dataset.on = String(playingAt(s, position))
      button.dataset.elsewhere = String(elsewhereAt(s, position))
      const colour = slot && rgb?.(slot.kind)
      if (colour) button.style.setProperty('--slot', colour)
      else button.style.removeProperty('--slot')
    })
  }
  deck.state.watch(show, signal)
  deck.sounds.watch(show, signal)
  deck.bpm.watch((now) => (bpm.value = now.toFixed(1)), signal)
  return coloursOf(signal).then((loaded) => {
    rgb = loaded
    show()
  })
}

/** Without a controller: rekordbox's sampler volume slider (RB p.196 step 3), SAMPLER VOL's place on the FLX10's mixer. */
export function showSamplerVolume(section: HTMLElement, sampler: Controls<SamplerDeck>, signal: AbortSignal): void {
  const volume = make('input', { type: 'range', min: '0', max: '1', step: 'any' })
  bindRange(volume, sampler.deck.state, (s) => s.volume, sampler.volume, signal)
  mount(section, signal, make('label', { className: 'sampler-volume' }, 'SAMPLER VOL', volume))
}
