// Concern: one deck's hot cues on the page: each set slot's letter over the song, and without a controller 16 pads lit as the FLX10's, SHIFT+pad clearing | Non-concern: the rules | IO: deck <-> DOM
import { palette } from 'dj-controller'
import { make, mount } from '../../shared/dom.ts'
import { MODEL } from '../../shared/flx10.ts'
import { logger } from '../../shared/logger.ts'
import { pressable } from '../../shared/pressable.ts'
import type { ScreenShift } from '../../shared/screen-shift.ts'
import type { DeckState } from '../../shared/transport/deck-state.ts'
import type { Deck } from '../../shared/transport/deck.ts'
import { gridOf, type Grid } from '../../shared/transport/grid.ts'
import { SLOTS, slotName, type HotCue } from '../../shared/transport/hot-cue-state.ts'
import { pad, shiftPad } from '../../shared/hot-cues/actions.ts'
import { CUE_COLOUR, LOOP_COLOUR, padLightsOf } from '../../shared/hot-cues/lights.ts'

const percent = (frame: number, grid: Grid): string => `${(100 * Math.min(Math.max(frame, 0), grid.end)) / grid.end}%`

const kindOf = (cue: HotCue | null): string => cue?.kind ?? 'empty'

// G4: the jog screens' hot cue markers come over undecoded HID, so they show here only.
function showMarkers(strip: HTMLElement, deck: Deck, signal: AbortSignal): void {
  const grid = gridOf(deck)
  const markers = Array.from({ length: SLOTS }, (_, slot) => make('span', { className: 'marker', textContent: slotName(slot) }))
  strip.append(...markers)
  deck.state.watch(({ hotCues }) => {
    markers.forEach((marker, slot) => {
      const cue = hotCues[slot]
      marker.hidden = cue === null
      marker.dataset.cue = kindOf(cue)
      marker.style.setProperty('--at', percent(cue === null ? 0 : cue.kind === 'cue' ? cue.at : cue.in, grid))
      marker.style.setProperty('--to', percent(cue?.kind === 'loop' ? cue.out : 0, grid))
    })
  }, signal)
}

function showPads(area: HTMLElement, deck: Deck, shift: ScreenShift, signal: AbortSignal): void {
  const pads = Array.from({ length: SLOTS }, (_, slot) => make('button', { className: 'pad', type: 'button', textContent: slotName(slot) }))
  area.append(make('div', { className: 'hot-cue-pads', role: 'group', ariaLabel: 'hot cues' }, ...pads))
  const show = (s: DeckState) => {
    const lights = padLightsOf(s)
    pads.forEach((button, slot) => {
      button.dataset.cue = kindOf(s.hotCues[slot])
      button.dataset.light = lights[slot].blink ? 'blink' : 'steady'
      button.disabled = !s.loaded
    })
  }
  pads.forEach((button, slot) => pressable(button, (time, key) => (shift.take(key) ? shiftPad(deck, slot) : pad(deck, slot, time)), signal))
  deck.state.watch(show, signal)
}

/** Colours each deck's hot cues as its pads light once the model palette loads, unless `signal` aborts first; never rejects, a failed load logged and the stylesheet's ink kept. */
export async function paintCues(areas: readonly HTMLElement[], signal: AbortSignal): Promise<void> {
  try {
    const colours = await palette(MODEL)
    if (signal.aborted) return
    for (const [token, colour] of [['--cue', CUE_COLOUR], ['--hot-loop', LOOP_COLOUR]] as const) {
      const rgb = colours.colour(colour)?.rgb
      if (rgb !== undefined) areas.forEach((area) => area.style.setProperty(token, rgb))
    }
  } catch (err) {
    logger.error('the hot cue colours did not load', err)
  }
}

/** Deck `deck`'s hot cues in `section`, and with `shift` its pads, until `signal` aborts; their area, for `paintCues`. */
export function showHotCues(section: HTMLElement, deck: Deck, shift: ScreenShift | null, signal: AbortSignal): HTMLElement {
  const strip = make('div', { className: 'cue-strip' })
  strip.ariaHidden = 'true'
  const area = make('div', { className: 'hot-cues' }, strip)
  mount(section, signal, area)
  showMarkers(strip, deck, signal)
  if (shift) showPads(area, deck, shift, signal)
  return area
}
