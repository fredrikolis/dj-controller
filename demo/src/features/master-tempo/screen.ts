// Concern: one deck's BPM on the page, any pending shown, and without a controller the MASTER TEMPO and TAP buttons | Non-concern: the BPM arithmetic (lock.ts) | IO: (deck, section) -> DOM
import { make, mount } from '../../shared/dom.ts'
import { pressable } from '../../shared/pressable.ts'
import type { Deck } from '../../shared/transport/deck.ts'
import { tapper } from './actions.ts'
import { playingBpm } from '../../shared/transport/bpm.ts'
import { pendingBpm } from '../../shared/transport/lock.ts'

/** The BPM in `section`, and with `controls` the MASTER TEMPO and TAP buttons, until `signal` aborts. */
export function showMasterTempo(section: HTMLElement, deck: Deck, controls: boolean, signal: AbortSignal): void {
  const playing = make('span')
  const pending = make('span', { className: 'pending', hidden: true })
  mount(section, signal, make('output', { className: 'bpm', ariaLabel: 'BPM' }, playing, pending))
  deck.state.watch((s) => {
    const asked = pendingBpm(s, deck.song.bpm)
    playing.textContent = playingBpm(s, deck.song.bpm).toFixed(1)
    pending.hidden = asked === null
    pending.textContent = asked?.toFixed(1) ?? ''
  }, signal)
  if (!controls) return
  const button = make('button', { className: 'master-tempo', type: 'button', textContent: 'MASTER TEMPO' })
  const tap = make('button', { className: 'tap', type: 'button', textContent: 'TAP' })
  mount(section, signal, button, tap)
  const tapAt = tapper(deck)
  pressable(tap, (time) => tapAt(time), signal)
  button.addEventListener('click', () => deck.update({ masterTempo: !deck.state.state.masterTempo }), { signal })
  deck.state.watch((s) => (button.ariaPressed = String(s.masterTempo)), signal)
}
