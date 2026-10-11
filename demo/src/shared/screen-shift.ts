// Concern: a deck's one on-screen SHIFT, latched for the next press as the Shift key held is, read by every feature's controls | Non-concern: what a shifted press does | IO: (section, click) -> latch
import { make, mount } from './dom.ts'
import { createStore, type Watched } from './store.ts'

export type ScreenShift = Watched<boolean> & {
  take(shiftKey: boolean): boolean
}

export function screenShift(section: HTMLElement, signal: AbortSignal): ScreenShift {
  const latch = createStore(false)
  const button = make('button', { className: 'shift', type: 'button', textContent: 'SHIFT' })
  mount(section, signal, button)
  button.addEventListener('click', () => latch.update((on) => !on), { signal })
  latch.watch((on) => (button.ariaPressed = String(on)), signal)
  return {
    get state() {
      return latch.state
    },
    watch: latch.watch,
    take(shiftKey) {
      const shifted = latch.state || shiftKey
      latch.update(() => false)
      return shifted
    },
  }
}
