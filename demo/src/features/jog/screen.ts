// Concern: one deck's on-screen platter: dragged to scratch or nudge, arrow keys to nudge, none with SHIFT, its marker turning; VINYL | Non-concern: what a turn does | IO: (deck, section) -> jogs, DOM
import { secsPerBar } from '../../shared/beat-grid/beat-grid.ts'
import { make, mount } from '../../shared/dom.ts'
import { frames } from '../../shared/frames.ts'
import type { ScreenShift } from '../../shared/screen-shift.ts'
import type { Deck } from '../../shared/transport/deck.ts'
import { framesOf, turnOf } from './turns.ts'
import { switched } from './vinyl.ts'

// The platter's outer fifth is its rim: a drag there nudges, a drag on its top scratches.
const RIM = 0.8
// An arrow key turns the rim once: a nudge of 0.18 s.
const KEY_TURNS = 1

function draggable(platter: HTMLElement, deck: Deck, shift: ScreenShift, turn: (turns: number) => void, signal: AbortSignal): void {
  let drag: { angle: number; scratch: boolean } | null = null
  const at = (e: PointerEvent) => {
    const box = platter.getBoundingClientRect()
    const x = e.clientX - box.left - box.width / 2
    const y = e.clientY - box.top - box.height / 2
    return { angle: Math.atan2(y, x), radius: Math.hypot(x, y) / (box.width / 2) }
  }
  const end = () => {
    if (drag?.scratch) deck.update({ touched: false })
    drag = null
  }
  platter.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0 || shift.take(e.shiftKey)) return
      platter.setPointerCapture(e.pointerId)
      const { angle, radius } = at(e)
      drag = { angle, scratch: radius < RIM && deck.state.state.vinyl }
      if (drag.scratch) deck.update({ touched: true })
    },
    { signal },
  )
  platter.addEventListener(
    'pointermove',
    (e) => {
      if (!drag) return
      const { angle } = at(e)
      // The shortest way round, so crossing the left edge is not a whole turn back.
      const delta = Math.atan2(Math.sin(angle - drag.angle), Math.cos(angle - drag.angle))
      drag.angle = angle
      turn(delta / (2 * Math.PI))
    },
    { signal },
  )
  for (const type of ['pointerup', 'pointercancel'] as const) platter.addEventListener(type, end, { signal })
}

/** Turns `platter`'s marker with `deck`'s playhead each frame, its value the playhead's second in the loop, until `signal` aborts. */
async function turnWithPlayhead(platter: HTMLElement, deck: Deck, signal: AbortSignal): Promise<void> {
  const loop = deck.song.bars * secsPerBar(deck.song.bpm)
  platter.ariaValueMax = String(Math.floor(loop))
  for await (const _ of frames(signal)) {
    const secs = deck.position / deck.sampleRate
    platter.style.setProperty('--turn', `${turnOf(deck.position, deck.sampleRate)}turn`)
    const now = String(Math.floor(((secs % loop) + loop) % loop))
    if (platter.ariaValueNow === now) continue
    platter.ariaValueNow = now
    platter.ariaValueText = `${now} s`
  }
}

/** Deck `deck`'s platter and VINYL in `section` until `signal` aborts. */
export async function showPlatter(section: HTMLElement, deck: Deck, shift: ScreenShift, signal: AbortSignal): Promise<void> {
  const platter = make('div', { className: 'platter', role: 'slider', tabIndex: 0, ariaLabel: 'playhead', ariaValueMin: '0', ariaValueNow: '0', ariaKeyShortcuts: 'ArrowLeft ArrowRight' })
  const vinyl = make('button', { className: 'vinyl', type: 'button', textContent: 'VINYL' })
  mount(section, signal, platter, vinyl)
  vinyl.addEventListener('click', () => deck.update(switched(deck.state.state)), { signal })
  deck.state.watch((s) => (vinyl.ariaPressed = String(s.vinyl)), signal)
  const turn = (turns: number) => deck.jog(framesOf(turns, deck.state.state.touched, deck.sampleRate))
  draggable(platter, deck, shift, turn, signal)
  const keys: Readonly<Record<string, number>> = { ArrowLeft: -KEY_TURNS, ArrowRight: KEY_TURNS }
  platter.addEventListener(
    'keydown',
    (e) => {
      const turns = keys[e.key]
      if (turns === undefined) return
      e.preventDefault()
      if (!shift.take(e.shiftKey)) turn(turns)
    },
    { signal },
  )
  await turnWithPlayhead(platter, deck, signal)
}
