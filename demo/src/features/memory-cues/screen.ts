// Concern: one deck's memory cues on the page: each over the song, Active Loops red, the called one marked; unconnected CALL ◀/▶ and SHIFT | Non-concern: the rules | IO: deck <-> DOM
import { make, mount } from '../../shared/dom.ts'
import { call, deleteCalled, memory } from '../../shared/memory-cues/actions.ts'
import { calledOf } from '../../shared/memory-cues/memory-cue.ts'
import { pressable } from '../../shared/pressable.ts'
import type { ScreenShift } from '../../shared/screen-shift.ts'
import type { Deck } from '../../shared/transport/deck.ts'
import { gridOf, type Grid } from '../../shared/transport/grid.ts'
import { frameOf } from '../../shared/transport/memory-cue-state.ts'

const percent = (frame: number, grid: Grid): string => `${(100 * Math.min(Math.max(frame, 0), grid.end)) / grid.end}%`

// G4: the jog screens' memory markers come over undecoded HID (MAN p.34 items 5, 7), so they show here only.
function showMarkers(strip: HTMLElement, deck: Deck, signal: AbortSignal): void {
  const grid = gridOf(deck)
  deck.state.watch((s) => {
    const called = calledOf(s)
    strip.replaceChildren(
      ...s.memoryCues.map((point, i) => {
        const marker = make('span', { className: 'memory-marker' })
        marker.dataset.kind = point.kind
        marker.dataset.active = String(point.kind === 'loop' && point.active)
        marker.dataset.called = String(i === called)
        marker.style.setProperty('--at', percent(frameOf(point), grid))
        marker.style.setProperty('--to', percent(point.kind === 'loop' ? point.out : frameOf(point), grid))
        return marker
      }),
    )
  }, signal)
}

// MAN pp.14-15: SHIFT makes CALL ◀ save and CALL ▶ delete.
function showControls(area: HTMLElement, deck: Deck, shift: ScreenShift, signal: AbortSignal): void {
  const button = () => make('button', { className: 'call', type: 'button' })
  const back = button()
  const next = button()
  area.append(back, next)
  const label = (shifted: boolean) => {
    back.textContent = shifted ? 'MEMORY' : 'CALL ◀'
    next.textContent = shifted ? 'DELETE' : 'CALL ▶'
  }
  pressable(back, (time, key) => (shift.take(key) ? memory(deck) : call(deck, -1, time)), signal)
  pressable(next, (time, key) => (shift.take(key) ? deleteCalled(deck) : call(deck, 1, time)), signal)
  shift.watch(label, signal)
  label(shift.state)
  deck.state.watch(({ loaded }) => {
    back.disabled = !loaded
    next.disabled = !loaded
  }, signal)
}

/** Deck `deck`'s memory cues in `section`, and with `shift` its CALL buttons, until `signal` aborts. */
export function showMemoryCues(section: HTMLElement, deck: Deck, shift: ScreenShift | null, signal: AbortSignal): void {
  const strip = make('div', { className: 'memory-strip' })
  strip.ariaHidden = 'true'
  const area = make('div', { className: 'memory-cues' }, strip)
  mount(section, signal, area)
  showMarkers(strip, deck, signal)
  if (shift) showControls(area, deck, shift, signal)
}
