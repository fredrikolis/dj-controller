// Concern: makes a drawn part playable: pointer, key and wheel as its hands' gestures, or a hold lighting its LED | Non-concern: what a gesture or lighting does, drawing | IO: (node, hands) -> listeners
import type { Hands, Point } from './gestures.js'
import { logger } from './logger.js'

const pressing = (e: KeyboardEvent) => e.key === 'Enter' || e.key === ' '

function named(g: SVGGElement, role: string, label: string): void {
  g.classList.add('led')
  Object.entries({ role, tabindex: '0', 'aria-label': label }).forEach(([k, v]) => g.setAttribute(k, v))
}

export function holdable(g: SVGGElement, label: string, light: (held: boolean) => Promise<void>, signal: AbortSignal): void {
  const hold = async (held: boolean) => {
    try {
      await light(held)
    } catch (error) {
      logger.error('the twin could not light a part', error)
    }
  }
  const key = (held: boolean) => async (e: KeyboardEvent) => {
    if (!pressing(e) || (held && e.repeat)) return
    e.preventDefault()
    await hold(held)
  }
  named(g, 'button', label)
  g.addEventListener('pointerdown', async () => await hold(true), { signal })
  // Switching away fires no pointerup or keyup, only blur.
  for (const end of ['pointerup', 'pointerleave', 'pointercancel', 'lostpointercapture', 'blur']) g.addEventListener(end, async () => await hold(false), { signal })
  g.addEventListener('keydown', key(true), { signal })
  g.addEventListener('keyup', key(false), { signal })
}

/** A virtual controller's part played by `hands`: one pointer at a time, captured from its press to its release; `at` gives an event's point in the layout's units. Its hold ends when `signal` aborts. */
export function playable(g: SVGGElement, label: string, hands: Hands, at: (e: PointerEvent) => Point, signal: AbortSignal): void {
  const play = (gesture: () => void) => {
    try {
      gesture()
    } catch (error) {
      logger.error(`the twin could not play ${label}`, error)
    }
  }
  let pointer: number | undefined
  const up = (e: PointerEvent) => {
    if (e.pointerId !== pointer) return
    pointer = undefined
    play(() => hands.up())
  }
  named(g, hands.role, label)
  g.classList.add('played')
  g.addEventListener(
    'pointerdown',
    (e) => {
      if (pointer !== undefined || (e.pointerType === 'mouse' && e.button !== 0)) return
      pointer = e.pointerId
      e.preventDefault()
      g.focus({ preventScroll: true })
      // A capture a browser refuses only loses the drag past the part's edge.
      if (g.isConnected) g.setPointerCapture(e.pointerId)
      play(() => hands.down(at(e), e.shiftKey))
    },
    { signal },
  )
  g.addEventListener('pointermove', (e) => (e.pointerId === pointer ? play(() => hands.move(at(e))) : undefined), { signal })
  for (const end of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) g.addEventListener(end, up, { signal })
  const key = (down: boolean) => (e: KeyboardEvent) => {
    if (e.repeat && pressing(e)) return e.preventDefault()
    play(() => (hands.key(e.key, down, e.shiftKey) ? e.preventDefault() : undefined))
  }
  g.addEventListener('keydown', key(true), { signal })
  g.addEventListener('keyup', key(false), { signal })
  // Switching away fires no keyup or pointerup, only blur.
  g.addEventListener('blur', () => play(() => (hands.up(), hands.key('Enter', false, false))), { signal })
  const { wheel, reset } = hands
  if (wheel) g.addEventListener('wheel', (e) => (e.preventDefault(), play(() => wheel(-Math.sign(e.deltaY)))), { signal, passive: false })
  if (reset) g.addEventListener('dblclick', () => play(reset), { signal })
  signal.addEventListener('abort', () => play(() => (hands.up(), hands.key('Enter', false, false))), { once: true })
}
