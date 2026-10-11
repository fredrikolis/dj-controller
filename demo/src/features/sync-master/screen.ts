// Concern: one deck's on-screen MASTER without a controller: pressed, the deck is the sync master; lit on the master | Non-concern: what follows the master | IO: (desk, section) -> DOM
import { make, mount } from '../../shared/dom.ts'
import type { DeckIndex } from '../../shared/decks.ts'
import type { Desk } from '../../shared/engine/engine.ts'

/** SHIFT+BEAT SYNC on the FLX10 (MAN p.17): MASTER in `section` until `signal` aborts. */
export function showSyncMaster(section: HTMLElement, desk: Desk, deck: DeckIndex, signal: AbortSignal): void {
  const button = make('button', { className: 'sync-master', type: 'button', textContent: 'MASTER' })
  mount(section, signal, button)
  button.addEventListener('click', () => desk.chooseMaster(deck), { signal })
  desk.syncMaster.watch((master) => (button.ariaPressed = String(master === deck)), signal)
}
