// Concern: keeps outputs showing a plan: steady values written where the base differs, blinks as leases in phase; a pad mode's banks | Non-concern: what to show | IO: (plan) -> writes, leases
import type { ColourPad, LedButton, Pattern } from 'dj-controller'

/** An LED or pad as the driver's. */
export type Output<T> = { readonly base: T | undefined; set(value: T): Promise<void>; play(pattern: Pattern<T>, options: { signal: AbortSignal }): Promise<unknown> }

export type Steady = { readonly kind: 'led'; readonly out: Output<boolean>; readonly value: boolean } | { readonly kind: 'pad'; readonly out: Output<number>; readonly value: number }

export type Blink =
  | { readonly kind: 'led'; readonly name: string; readonly out: Output<boolean>; readonly pattern: Pattern<boolean> }
  | { readonly kind: 'pad'; readonly name: string; readonly out: Output<number>; readonly pattern: Pattern<number> }

export type Plan = { readonly steady: readonly Steady[]; readonly blinks: readonly Blink[] }

export const ledOut = (button: LedButton<unknown>): Output<boolean> => ({
  get base() {
    return button.base
  },
  set: (on) => button.led(on),
  play: (pattern, options) => button.play(pattern, options),
})

export const padOut = (pad: ColourPad<unknown>): Output<number> => ({
  get base() {
    return pad.base
  },
  set: (colour) => pad.colour(colour),
  play: (pattern, options) => pad.play(pattern, options),
})

export type PageViews = { readonly pads: readonly Output<number>[]; readonly shifted: readonly Output<number>[] }

/** Each page's pads and their SHIFT layer, and the PAGE LEDs, of one pad mode: banks, so they paint while the mode is hidden. */
export type ModeViews = { readonly pages: readonly PageViews[]; readonly left: Output<boolean>; readonly right: Output<boolean> }

type PadMode = {
  readonly pages: readonly { readonly pads: readonly ColourPad<unknown>[]; readonly shifted: { readonly pads: readonly ColourPad<unknown>[] } }[]
  readonly page: { readonly left: LedButton<unknown>; readonly right: LedButton<unknown> }
}

export const modeViewsOf = (mode: PadMode): ModeViews => ({
  pages: mode.pages.map((page) => ({ pads: page.pads.map(padOut), shifted: page.shifted.pads.map(padOut) })),
  left: ledOut(mode.page.left),
  right: ledOut(mode.page.right),
})

const write = (s: Steady): Promise<void> => (s.kind === 'led' ? s.out.set(s.value) : s.out.set(s.value))

/** Every blink runs from time 0 on the controller's clock, so blinks any feature starts at any time show in phase. */
const ORIGIN = 0

const start = (b: Blink, signal: AbortSignal): Promise<unknown> =>
  b.kind === 'led' ? b.out.play({ ...b.pattern, origin: ORIGIN }, { signal }) : b.out.play({ ...b.pattern, origin: ORIGIN }, { signal })

/** Writes each steady value its base lacks, then restarts changed blinks. */
export function showLights(signal: AbortSignal): (plan: Plan) => Promise<void> {
  let running: { readonly key: string; readonly stop: AbortController } | null = null
  return async ({ steady, blinks }) => {
    const key = blinks.map((b) => b.name).join(' ')
    try {
      await Promise.all(steady.filter((s) => s.out.base !== s.value).map(write))
      if (running?.key === key) return
      running?.stop.abort()
      const stop = new AbortController()
      running = { key, stop }
      await Promise.all(blinks.map((b) => start(b, AbortSignal.any([signal, stop.signal]))))
    } catch (err) {
      if (!signal.aborted) throw err
    }
  }
}
