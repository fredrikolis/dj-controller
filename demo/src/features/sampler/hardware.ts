// Concern: the sampler on the FLX10: SAMPLER pads, SHIFT+pad, PAGE in Sampler mode and SAMPLER VOL in; pad colours and PAGE LEDs out | Non-concern: the rules, what lights | IO: controls <-> sampler
import { DECKS } from '../../shared/decks.ts'
import type { Flx10, Flx10Deck } from '../../shared/flx10.ts'
import { modeViewsOf, showLights } from '../../shared/lights/show-lights.ts'
import { positionOf } from '../../shared/sampler/banks.ts'
import { changes, createStore } from '../../shared/store.ts'
import { follow, until } from '../../shared/streams.ts'
import type { SamplerDeck } from '../../shared/sampler/sampler-deck.ts'
import { unlessRefused, type Sampler as Controls } from './actions.ts'
import { planOf } from './lights.ts'

type Sampler = Controls<SamplerDeck>

function keepLights(controls: Flx10Deck, deck: number, sampler: Sampler, signal: AbortSignal): Promise<void>[] {
  const show = showLights(signal)
  const views = modeViewsOf(controls.modes.sampler)
  const seen = createStore(0)
  const bump = () => seen.update((n) => n + 1)
  sampler.deck.state.watch(bump, signal)
  sampler.deck.sounds.watch(bump, signal)
  const plan = () => planOf(views, deck, sampler.deck.state.state, (slot) => sampler.deck.sounds.state.has(slot.node), controls.mode.mode === 'sampler')
  return [follow(controls.modeChanges({ signal }), bump, signal), follow(changes(seen, signal), () => show(plan()), signal)]
}

function playDeck(controls: Flx10Deck, deck: number, sampler: Sampler, signal: AbortSignal): Promise<void>[] {
  const paging = (button: Flx10Deck['page'][keyof Flx10Deck['page']], direction: -1 | 1) =>
    follow(button.presses({ signal }), (press) => (press.mode === 'sampler' && !press.shift ? sampler.page(direction) : undefined), signal)
  return [
    // MML P1-P8: 9p 30-3F, SHIFT on p+1.
    ...controls.pads.map((pad) =>
      follow(
        pad.hits({ signal }),
        async (hit) => {
          if (hit.mode !== 'sampler') return
          const letGo = unlessRefused(() => sampler.press(positionOf(deck, hit.pad), hit.shift))
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
    // MAN p.83 step 2; MML P13/P14.
    paging(controls.page.left, -1),
    paging(controls.page.right, 1),
    ...keepLights(controls, deck, sampler, signal),
  ]
}

export function playSampler(controller: Flx10, sampler: Sampler, signal: AbortSignal): Promise<void>[] {
  // MML M20; MAN p.52 item 17.
  const volume = controller.mixer.samplerVolume
  if (volume.value !== undefined) sampler.volume(volume.value / volume.max)
  return [
    ...DECKS.flatMap((deck) => playDeck(controller.decks[deck], deck, sampler, signal)),
    follow(volume.changes({ signal }), (value) => sampler.volume(value / volume.max), signal),
  ]
}
