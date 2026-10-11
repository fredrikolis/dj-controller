// Concern: one deck's hot cues on the FLX10: HOT CUE pads and SHIFT+pad in; both pages' colours, blinks, PAGE LEDs out | Non-concern: the rules, what lights (lights.ts) | IO: controls <-> deck
import type { Flx10Deck } from '../../shared/flx10.ts'
import { modeViewsOf, showLights } from '../../shared/lights/show-lights.ts'
import { changes, createStore } from '../../shared/store.ts'
import { follow } from '../../shared/streams.ts'
import type { Deck } from '../../shared/transport/deck.ts'
import { pad, shiftPad } from '../../shared/hot-cues/actions.ts'
import { slotOf } from '../../shared/hot-cues/hot-cue.ts'
import { padLightsOf, planOf } from '../../shared/hot-cues/lights.ts'

const hotCuePage = (controls: Flx10Deck): number | null => (controls.mode.mode === 'hotCue' ? (controls.mode.page ?? null) : null)

function keepLights(controls: Flx10Deck, deck: Deck, signal: AbortSignal): Promise<void>[] {
  const show = showLights(signal)
  // MML p.6 P13/P14, p.7 *1.
  const views = modeViewsOf(controls.modes.hotCue)
  const seen = createStore(0)
  const bump = () => seen.update((n) => n + 1)
  deck.state.watch(bump, signal)
  return [
    follow(controls.modeChanges({ signal }), bump, signal),
    follow(changes(seen, signal), () => show(planOf(views, padLightsOf(deck.state.state), hotCuePage(controls))), signal),
  ]
}

export function playHotCues(controls: Flx10Deck, deck: Deck, signal: AbortSignal): Promise<void>[] {
  // CUE/LOOP CALL is memory cues' (MAN p.87); SHIFT+HOT CUE is Keyboard's (MAN p.84).
  return [
    // MML P1-P8: 9p 00-0F, SHIFT on p+1 (p.7 *1).
    ...controls.pads.map((control) =>
      follow(
        control.hits({ signal }),
        (hit) => {
          if (hit.mode !== 'hotCue') return
          const slot = slotOf(hit.page, hit.pad)
          if (hit.shift) shiftPad(deck, slot)
          else pad(deck, slot, hit.time)
        },
        signal,
      ),
    ),
    ...keepLights(controls, deck, signal),
  ]
}
