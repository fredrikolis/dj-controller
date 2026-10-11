// Concern: what a deck's PAD FX pads light: each slot's effect colour, the whitest while on, both banks and SHIFT layers, PAGE LEDs, as a plan | Non-concern: writing it | IO: (holding, mode) -> plan
import type { ModeViews, Plan, Steady } from '../../shared/lights/show-lights.ts'
import { slotAt, slotOf, type Effect } from './banks.ts'
import { isOn, type Holding } from './hold.ts'

// ASSUMPTION: RB p.235 publishes no [PAD FX color] values.
export const EFFECT_COLOURS: Readonly<Record<Effect, number>> = {
  echo: 9,
  lowCutEcho: 13,
  dubEcho: 17,
  reverb: 61,
  trans: 29,
  flanger: 53,
  phaser: 57,
  roll: 37,
  revRoll: 33,
  lpf: 21,
  hpf: 25,
  crush: 41,
  releaseEcho: 49,
  vBrake: 49,
  backSpin: 49,
}

// RB p.189: a held pad lights up. ASSUMPTION: whitest.
export const ON_COLOUR = 127

export function planOf(banks: readonly ModeViews[], holding: Holding, shown: { readonly bank: number; readonly page: number } | null): Plan {
  const steady: Steady[] = []
  banks.forEach((views, bank) =>
    views.pages.forEach(({ pads, shifted }, page) => {
      for (const outs of [pads, shifted]) {
        outs.forEach((out, pad) => {
          const slot = slotAt(bank, page, pad)
          steady.push({ kind: 'pad', out, value: isOn(holding, slot) ? ON_COLOUR : EFFECT_COLOURS[slotOf(slot).effect] })
        })
      }
    }),
  )
  // ASSUMPTION: as the hot cues.
  if (shown === null) return { steady, blinks: [] }
  const views = banks[shown.bank]
  if (!views) throw new RangeError(`no PAD FX bank ${shown.bank}: the FLX10 has PAD FX1 and PAD FX2, banks 0 and 1 (MAN pp.17-18)`)
  steady.push({ kind: 'led', out: views.left, value: shown.page === 0 }, { kind: 'led', out: views.right, value: shown.page === 1 })
  return { steady, blinks: [] }
}
