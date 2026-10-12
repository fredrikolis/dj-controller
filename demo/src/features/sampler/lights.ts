// Concern: what a deck's SAMPLER pads light: each slot's colour, a blink while playing, on both device pages and SHIFT layers; PAGE LEDs | Non-concern: writing it | IO: (sampler state) -> plan
import type { Pattern } from 'dj-controller'
import type { Blink, ModeViews, Plan, Steady } from '../../shared/lights/show-lights.ts'
import { BANKS, positionOf, slotAt, type Kind, type Slot } from '../../shared/sampler/banks.ts'
import type { SamplerState } from '../../shared/sampler/sampler-state.ts'
import { playingAt } from './players.ts'

// RB p.196, p.235: each slot's own colour. ASSUMPTION: by kind.
const KIND_COLOURS: Readonly<Record<Kind, number>> = { drum: 37, stab: 9, fx: 53, loop: 21 }

const EMPTY_COLOUR = 0

// ASSUMPTION: as the hot loop's.
const playingBlink = (colour: number): Pattern<number> => ({ steps: [[colour, 250], [127, 250]], repeat: true })

export function planOf(views: ModeViews, deck: number, s: SamplerState, ready: (slot: Slot) => boolean, showing: boolean): Plan {
  const steady: Steady[] = []
  const blinks: Blink[] = []
  views.pages.forEach(({ pads, shifted }, page) => {
    for (const [layer, outs] of [['plain', pads], ['shifted', shifted]] as const) {
      outs.forEach((out, pad) => {
        const position = positionOf(deck, pad)
        const slot = slotAt(s.bank, position)
        if (slot === null || !ready(slot)) steady.push({ kind: 'pad', out, value: EMPTY_COLOUR })
        else if (playingAt(s, position)) blinks.push({ kind: 'pad', name: `sampler ${page} ${pad} ${layer} ${s.bank}`, out, pattern: playingBlink(KIND_COLOURS[slot.kind]) })
        else steady.push({ kind: 'pad', out, value: KIND_COLOURS[slot.kind] })
      })
    }
  })
  // ASSUMPTION: lit where PAGE can go.
  if (showing) steady.push({ kind: 'led', out: views.left, value: s.bank > 0 }, { kind: 'led', out: views.right, value: s.bank < BANKS - 1 })
  return { steady, blinks }
}
