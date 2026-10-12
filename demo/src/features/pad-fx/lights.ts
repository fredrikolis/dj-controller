// Concern: a deck's PAD FX pad lights: each slot's effect colour, the whitest while on, PAGE's LEDs | Non-concern: writing it | IO: (holding, shown) -> plan
import { padPlan, pageShowing } from '../../shared/lights/pad-lights.ts'
import type { ModeViews, Plan } from '../../shared/lights/show-lights.ts'
import { slotAt, slotOf, type Effect } from './banks.ts'
import { isOn, type Holding } from './hold.ts'

// ASSUMPTION: RB p.235 publishes no [PAD FX color] values.
const EFFECT_COLOURS: Readonly<Record<Effect, number>> = {
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
const ON_COLOUR = 127

export const planOf = (banks: readonly ModeViews[], holding: Holding, shown: { readonly bank: number; readonly page: number } | null): Plan =>
  padPlan(
    banks.map((views, bank) => ({
      views,
      light: (page, pad) => {
        const slot = slotAt(bank, page, pad)
        return isOn(holding, slot) ? ON_COLOUR : EFFECT_COLOURS[slotOf(slot).effect]
      },
      leds: pageShowing(shown?.bank === bank ? shown.page : null),
    })),
  )
