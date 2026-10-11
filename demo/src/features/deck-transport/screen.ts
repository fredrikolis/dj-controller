// Concern: one deck's on-screen transport: title, TEMPO range, and without a controller PLAY, CUE held, REV, TEMPO, SHIFT read | Non-concern: the rules | IO: (deck, section) -> DOM
import { make, mount } from '../../shared/dom.ts'
import { holdable } from '../../shared/holdable.ts'
import { bindRange } from '../../shared/range.ts'
import type { ScreenShift } from '../../shared/screen-shift.ts'
import type { Deck } from '../../shared/transport/deck.ts'
import { rangeText } from '../../shared/transport/tempo.ts'
import { cueDown, cueUp, play, reverse, stepRange } from './press.ts'

export function showTransport(section: HTMLElement, deck: Deck, shift: ScreenShift | null, signal: AbortSignal): void {
  const range = shift ? make('button', { className: 'tempo-range', type: 'button' }) : make('output', { className: 'tempo-range' })
  mount(section, signal, make('h2', { className: 'title', textContent: deck.song.title }), range)
  deck.state.watch((s) => {
    section.ariaBusy = String(!s.loaded)
    range.textContent = rangeText(s.tempoRange)
    range.ariaLabel = `tempo range ${range.textContent}`
  }, signal)
  if (!shift) return
  range.addEventListener('click', () => stepRange(deck), { signal })
  // Min at the top, faster toward the player as on the FLX10 (docs/research/flx10-observed-tempo.md).
  const tempo = make('input', { className: 'tempo', type: 'range', min: '0', max: '1', step: 'any', ariaLabel: 'tempo' })
  const cue = make('button', { className: 'cue', type: 'button', textContent: 'CUE' })
  const playButton = make('button', { className: 'play', type: 'button', ariaLabel: 'play' })
  // SHIFT+SLIP REVERSE on the FLX10 (MAN p.21).
  const rev = make('button', { className: 'reverse', type: 'button', textContent: 'REV' })
  mount(section, signal, tempo, cue, playButton, rev)
  rev.addEventListener('click', () => reverse(deck, true), { signal })
  bindRange(tempo, deck.state, (s) => s.tempo, (p) => deck.update({ tempo: p }), signal)
  playButton.addEventListener('click', (e) => play(deck, shift.take(e.shiftKey)), { signal })
  holdable(cue, (_, key) => cueDown(deck, shift.take(key)), () => cueUp(deck), signal)
  deck.state.watch((s) => {
    playButton.disabled = cue.disabled = rev.disabled = !s.loaded
    playButton.ariaPressed = String(s.playing)
    rev.ariaPressed = String(s.reverse)
  }, signal)
}
