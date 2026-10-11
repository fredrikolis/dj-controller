// Concern: page plumbing: its life as a signal, an audio context for it, errors shown on a line | Non-concern: the controller, the desk | IO: page events -> signal, context, text
import { errorText } from './error-text.ts'
import { logger } from './logger.ts'

/** Ends when the page is hidden for good. */
export function pageLife(): AbortSignal {
  const life = new AbortController()
  addEventListener('pagehide', () => life.abort(), { once: true })
  // Restored from the back/forward cache.
  addEventListener('pageshow', (e) => e.persisted && location.reload())
  return life.signal
}

// Browsers start audio only from a click or key press.
export function audioFor(signal: AbortSignal): AudioContext {
  const ctx = new AudioContext({ latencyHint: 'interactive' })
  const resume = async () => {
    try {
      await ctx.resume()
    } catch (err) {
      logger.error('the audio did not start', err)
    }
  }
  for (const type of ['pointerdown', 'keydown'] as const) addEventListener(type, resume, { capture: true, signal })
  signal.addEventListener(
    'abort',
    async () => {
      try {
        await ctx.close()
      } catch (err) {
        logger.error('the audio context did not close', err)
      }
    },
    { once: true },
  )
  return ctx
}

export function reporter(line: HTMLElement, signal: AbortSignal): (err: unknown) => void {
  addEventListener('click', (e) => e.target instanceof Element && e.target.closest('button') && (line.hidden = true), { capture: true, signal })
  return (err) => {
    logger.error('the demo failed', err)
    line.textContent = errorText(err)
    line.hidden = false
  }
}
