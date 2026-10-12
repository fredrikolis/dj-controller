// Concern: pad modes' plan from each pad's light as data: hidden pages painted, SHIFT's pads as the plain, PAGE LEDs only while showing | Non-concern: which colour, pattern | IO: (modes) -> plan
import type { Pattern } from 'dj-controller'
import type { Blink, ModeViews, Plan, Steady } from './show-lights.ts'

export type PadLight = number | Pattern<number>

type PageLeds = { readonly left: boolean; readonly right: boolean }

/** `leds` null while another mode shows. */
type PadMode = { readonly views: ModeViews; readonly light: (page: number, pad: number) => PadLight; readonly leds: PageLeds | null }

export const pageShowing = (page: number | null): PageLeds | null => (page === null ? null : { left: page === 0, right: page === 1 })

/** A lease is named by its pad and steps, so a changed pattern plays afresh. */
export function padPlan(modes: readonly PadMode[]): Plan {
  const steady: Steady[] = []
  const blinks: Blink[] = []
  modes.forEach(({ views, light }, mode) =>
    views.pages.forEach(({ pads, shifted }, page) => {
      for (const [layer, outs] of [['plain', pads], ['shifted', shifted]] as const) {
        outs.forEach((out, pad) => {
          const shown = light(page, pad)
          if (typeof shown === 'number') steady.push({ kind: 'pad', out, value: shown })
          else blinks.push({ kind: 'pad', name: `pad ${mode} ${page} ${pad} ${layer} ${JSON.stringify(shown.steps)}`, out, pattern: shown })
        })
      }
    }),
  )
  for (const { views, leds } of modes) {
    if (leds !== null) steady.push({ kind: 'led', out: views.left, value: leds.left }, { kind: 'led', out: views.right, value: leds.right })
  }
  return { steady, blinks }
}
