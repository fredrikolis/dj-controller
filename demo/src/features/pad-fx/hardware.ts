// Concern: one deck's PAD FX on the FLX10: pads held in PAD FX1/2 and BEAT ◀/▶ in; pad colours, PAGE LEDs out; the bank showing | Non-concern: the rules, what lights | IO: controls <-> deck fx
import type { Flx10, Flx10Deck } from '../../shared/flx10.ts'
import { modeViewsOf, showLights } from '../../shared/lights/show-lights.ts'
import { changes, createStore, type Store } from '../../shared/store.ts'
import { follow, until } from '../../shared/streams.ts'
import { unlessRefused, type DeckFx } from './actions.ts'
import { slotAt } from './banks.ts'
import { planOf } from './lights.ts'

export type Shown = { readonly bank: number; readonly page: number } | null

// MAN pp.17-18 item 14: PAD FX1 enters bank 1, SHIFT+PAD FX1 bank 2.
const BANKS = { padFx1: 0, padFx2: 1 } as const

const isPadFx = (mode: string | undefined): mode is keyof typeof BANKS => mode === 'padFx1' || mode === 'padFx2'

const shownOf = (controls: Flx10Deck): Shown => {
  const { mode, page } = controls.mode
  return isPadFx(mode) && page !== undefined ? { bank: BANKS[mode], page } : null
}

function keepLights(controls: Flx10Deck, fx: DeckFx, shown: Store<Shown>, signal: AbortSignal): Promise<void>[] {
  const show = showLights(signal)
  // MML P1-P8, P13/P14.
  const banks = [modeViewsOf(controls.modes.padFx1), modeViewsOf(controls.modes.padFx2)]
  const seen = createStore(0)
  const bump = () => seen.update((n) => n + 1)
  fx.holding.watch(bump, signal)
  shown.watch(bump, signal)
  return [
    follow(controls.modeChanges({ signal }), () => shown.update(() => shownOf(controls)), signal),
    follow(changes(seen, signal), () => show(planOf(banks, fx.holding.state, shown.state)), signal),
  ]
}

export function playPadFx(controls: Flx10Deck, fx: DeckFx, shown: Store<Shown>, signal: AbortSignal): Promise<void>[] {
  shown.update(() => shownOf(controls))
  return [
    ...controls.pads.map((pad) =>
      follow(
        pad.hits({ signal }),
        async (hit) => {
          // ASSUMPTION: SHIFT+pad does nothing; the manuals give Pad FX no SHIFT layer.
          if (!isPadFx(hit.mode) || hit.shift) return
          const slot = slotAt(BANKS[hit.mode], hit.page, hit.pad)
          const letGo = unlessRefused(() => fx.hold(slot))
          if (letGo === null) return
          try {
            await until(hit.released, signal)
          } finally {
            letGo()
          }
        },
        signal,
      ),
    ),
    ...keepLights(controls, fx, shown, signal),
  ]
}

// RB p.189; MML F11, F12. ASSUMPTION: the mixer's buttons step every deck's held pads.
export function playBeatButtons(controller: Flx10, fxs: readonly DeckFx[], signal: AbortSignal): Promise<void>[] {
  const { left, right } = controller.effect.beat
  return [
    follow(left.presses({ signal }), (press) => (press.shift ? undefined : fxs.forEach((fx) => unlessRefused(() => fx.step(-1)))), signal),
    follow(right.presses({ signal }), (press) => (press.shift ? undefined : fxs.forEach((fx) => unlessRefused(() => fx.step(1)))), signal),
  ]
}
