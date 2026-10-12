// Concern: what a deck's SAMPLER pads light: each slot's colour, a blink while playing; PAGE lit where it can go | Non-concern: writing it | IO: (sampler state) -> plan
import type { Pattern } from 'dj-controller'
import { padPlan } from '../../shared/lights/pad-lights.ts'
import type { ModeViews, Plan } from '../../shared/lights/show-lights.ts'
import { BANKS, positionOf, slotAt, type Kind, type Slot } from '../../shared/sampler/banks.ts'
import type { SamplerState } from '../../shared/sampler/sampler-state.ts'
import { playingAt } from './players.ts'

// RB p.196, p.235: each slot's own colour. ASSUMPTION: by kind.
const KIND_COLOURS: Readonly<Record<Kind, number>> = { drum: 37, stab: 9, fx: 53, loop: 21 }

const EMPTY_COLOUR = 0

// ASSUMPTION: as the hot loop's.
const playingBlink = (colour: number): Pattern<number> => ({ steps: [[colour, 250], [127, 250]], repeat: true })

// ASSUMPTION: PAGE's LEDs.
export const planOf = (views: ModeViews, deck: number, s: SamplerState, ready: (slot: Slot) => boolean, showing: boolean): Plan =>
  padPlan([
    {
      views,
      light: (_, pad) => {
        const position = positionOf(deck, pad)
        const slot = slotAt(s.bank, position)
        if (slot === null || !ready(slot)) return EMPTY_COLOUR
        return playingAt(s, position) ? playingBlink(KIND_COLOURS[slot.kind]) : KIND_COLOURS[slot.kind]
      },
      leds: showing ? { left: s.bank > 0, right: s.bank < BANKS - 1 } : null,
    },
  ])
