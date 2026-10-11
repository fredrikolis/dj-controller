// Concern: makes a drawn part a button whose LED is lit while a pointer or key holds it, each write awaited | Non-concern: what lighting writes, drawing | IO: (part's node, light) -> listeners
import { logger } from './logger.js'

const pressing = (e: KeyboardEvent) => e.key === 'Enter' || e.key === ' '

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
  g.classList.add('led')
  Object.entries({ role: 'button', tabindex: '0', 'aria-label': label }).forEach(([k, v]) => g.setAttribute(k, v))
  g.addEventListener('pointerdown', async () => await hold(true), { signal })
  // Switching away fires no pointerup or keyup, only blur.
  for (const end of ['pointerup', 'pointerleave', 'pointercancel', 'lostpointercapture', 'blur']) g.addEventListener(end, async () => await hold(false), { signal })
  g.addEventListener('keydown', key(true), { signal })
  g.addEventListener('keyup', key(false), { signal })
}
