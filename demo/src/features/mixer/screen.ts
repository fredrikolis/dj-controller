// Concern: the mixer's on-screen controls without a controller: each channel's EQ and fader, the crossfader, fader start | Non-concern: the curves, the hardware | IO: (mixer, section) -> mix, DOM
import { make, mount } from '../../shared/dom.ts'
import { DECKS, type DeckIndex, type Pair } from '../../shared/decks.ts'
import { BANDS, type Mixer } from '../../shared/mixer/mixer.ts'
import { bindRange } from '../../shared/range.ts'
import type { ScreenShift } from '../../shared/screen-shift.ts'
import type { Deck } from '../../shared/transport/deck.ts'
import { moveOf } from './fader-start.ts'
import { start } from './start.ts'

const range = (className: string, ariaLabel?: string) => make('input', { className, type: 'range', min: '0', max: '1', step: 'any', ...(ariaLabel && { ariaLabel }) })

function channel(mixer: Mixer, deck: DeckIndex, fader: HTMLInputElement, signal: AbortSignal): HTMLElement {
  const knobs = BANDS.map((band) => {
    const input = range('eq')
    bindRange(input, mixer.mix, (m) => m.channels[deck].eq[band], (p) => mixer.eq(deck, band, p), signal)
    return make('label', {}, band.toUpperCase(), input)
  })
  bindRange(fader, mixer.mix, (m) => m.channels[deck].fader, (p) => mixer.fader(deck, p), signal)
  return make('div', { className: 'channel', role: 'group', ariaLabel: `channel ${deck + 1}` }, ...knobs, fader)
}

// The keys that move a range input.
const MOVES: ReadonlySet<string> = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'])

/** MAN pp.90-91: a fader moved with SHIFT, either deck's latch or the key, starts or back-cues its deck; the move's first press takes the latch. */
function startWithShift(faders: readonly HTMLInputElement[], mixer: Mixer, decks: Pair<Deck>, shifts: Pair<ScreenShift>, signal: AbortSignal): void {
  let shifted = false
  const press = (e: PointerEvent | KeyboardEvent) => {
    if (e instanceof KeyboardEvent && (e.repeat || !MOVES.has(e.key))) return
    shifted = shifts.map((shift) => shift.take(e.shiftKey)).some(Boolean)
  }
  const letGo = () => (shifted = false)
  for (const fader of faders) {
    fader.addEventListener('pointerdown', press, { signal })
    fader.addEventListener('keydown', press, { signal })
    for (const end of ['pointerup', 'pointercancel', 'keyup', 'blur'] as const) fader.addEventListener(end, letGo, { signal })
  }
  let was = mixer.mix.state
  mixer.mix.watch((now) => {
    const before = was
    was = now
    if (!shifted) return
    for (const d of DECKS) {
      const move = moveOf(before, now, d)
      if (move) start(decks[d], move)
    }
  }, signal)
}

/** The mixer's controls in `section` until `signal` aborts. */
export function showMixer(section: HTMLElement, mixer: Mixer, decks: Pair<Deck>, shifts: Pair<ScreenShift>, signal: AbortSignal): void {
  const crossfader = range('crossfader', 'crossfader')
  const faders = [range('fader', 'fader'), range('fader', 'fader')] as const
  startWithShift([...faders, crossfader], mixer, decks, shifts, signal)
  bindRange(crossfader, mixer.mix, (m) => m.crossfader, mixer.crossfader, signal)
  mount(section, signal, ...DECKS.map((d) => channel(mixer, d, faders[d], signal)), crossfader)
}
