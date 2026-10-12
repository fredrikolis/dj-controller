// Concern: one controller's text on the twin: every feature's labels and display text as one map and one object, given whole | Non-concern: what the text is, drawing it | IO: (control, text) -> twin
import type { ColourPad, TwinDisplays, TwinLabelled } from 'dj-controller'
import type { Twin } from 'dj-controller/twin'
import { logger } from './logger.ts'

type Pages = { readonly pages: readonly { readonly pads: readonly ColourPad<unknown>[] }[] }

export type TwinText = {
  label(control: TwinLabelled, text: string | undefined): void
  /** Each pad of `mode`'s pages, as banks. */
  labelPads(mode: Pages, text: (page: number, pad: number) => string | undefined): void
  show<D extends keyof TwinDisplays>(display: D, text: TwinDisplays[D]): void
}

/** Until `signal` aborts, when the twin is left with no text. */
export function twinText(twin: Twin, signal: AbortSignal): TwinText {
  const labels = new Map<TwinLabelled, string>()
  const texts: { -readonly [D in keyof TwinDisplays]?: TwinDisplays[D] } = {}
  let pending = false
  const give = () => {
    pending = false
    try {
      twin.labels = signal.aborted ? new Map() : new Map(labels)
      twin.texts = signal.aborted ? {} : { ...texts }
    } catch (err) {
      logger.error('the twin refused a text', err)
    }
  }
  const changed = () => {
    if (pending) return
    pending = true
    queueMicrotask(give)
  }
  signal.addEventListener('abort', give, { once: true })
  const label: TwinText['label'] = (control, text) => {
    if (labels.get(control) === text) return
    if (text === undefined) labels.delete(control)
    else labels.set(control, text)
    changed()
  }
  return {
    label,
    labelPads: (mode, text) => mode.pages.forEach((views, page) => views.pads.forEach((pad, i) => label(pad, text(page, i)))),
    show(display, text) {
      texts[display] = text
      changed()
    },
  }
}
