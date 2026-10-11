// Concern: one deck's on-screen beat jump without a controller: 4 BEAT JUMP ◀ and ▶ pressed or held, both pages' BEAT JUMP pads, SHIFT read | Non-concern: the rules | IO: (deck, section) -> DOM
import { make, mount } from '../../shared/dom.ts'
import { holdable } from '../../shared/holdable.ts'
import { logger } from '../../shared/logger.ts'
import { pressable } from '../../shared/pressable.ts'
import type { ScreenShift } from '../../shared/screen-shift.ts'
import type { Deck } from '../../shared/transport/deck.ts'
import { jump, search } from './actions.ts'
import { buttonBeats, PAD_BEATS, padJump, type Direction } from './jump.ts'

const labelOf = (beats: number, direction: Direction): string => (direction < 0 ? `◀︎ ${beats}` : `${beats} ▶︎`)

// ASSUMPTION: the firmware's long press is unmeasured, and a long press sends no short one.
const LONG_PRESS_MS = 500

/** Let go before a long press, it jumps from where it was pressed; held past one, it searches until let go (MAN p.19 item 21). */
function pressOrHold(button: HTMLButtonElement, direction: Direction, deck: Deck, shift: ScreenShift, signal: AbortSignal): void {
  let letGo = (): void => {}
  holdable(
    button,
    (time, key) => {
      const beats = buttonBeats(shift.take(key))
      const held = new AbortController()
      const over = AbortSignal.any([signal, held.signal])
      const released = new Promise<void>((resolve) => over.addEventListener('abort', () => resolve(), { once: true }))
      let searching = false
      const timer = setTimeout(() => {
        searching = true
        search(deck, direction, released, signal).catch((err: unknown) => logger.error('the beat jump search failed', err))
      }, LONG_PRESS_MS)
      over.addEventListener('abort', () => {
        clearTimeout(timer)
        if (!searching && !signal.aborted) jump(deck, beats, direction, time)
      }, { once: true })
      letGo = () => held.abort()
    },
    () => letGo(),
    signal,
  )
}

export function showBeatJump(section: HTMLElement, deck: Deck, shift: ScreenShift, signal: AbortSignal): void {
  const back = make('button', { type: 'button', textContent: labelOf(4, -1) })
  const forward = make('button', { type: 'button', textContent: labelOf(4, 1) })
  // Each page a row of 8, pads 1 to 8 (MAN p.82).
  const pads = PAD_BEATS.flatMap((page, p) =>
    Array.from({ length: page.length * 2 }, (_, i) => {
      const { beats, direction } = padJump(p, i)
      return { beats, direction, button: make('button', { className: 'pad', type: 'button', textContent: labelOf(beats, direction) }) }
    }),
  )
  mount(
    section,
    signal,
    make('div', { className: 'beat-jump', role: 'group', ariaLabel: '4 beat jump' }, back, forward),
    make('div', { className: 'beat-jump-pads', role: 'group', ariaLabel: 'beat jump' }, ...pads.map((p) => p.button)),
  )
  pressOrHold(back, -1, deck, shift, signal)
  pressOrHold(forward, 1, deck, shift, signal)
  for (const { beats, direction, button } of pads) pressable(button, (time, key) => (shift.take(key) ? undefined : jump(deck, beats, direction, time)), signal)
  const buttons = [back, forward, ...pads.map((p) => p.button)]
  deck.state.watch((s) => buttons.forEach((b) => (b.disabled = !s.loaded)), signal)
}
