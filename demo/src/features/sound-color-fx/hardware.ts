// Concern: Sound Color FX on the FLX10: the six SOUND COLOR FX buttons and channels 1 and 2's COLOR knobs in; the selected button flashing out | Non-concern: the rules, audio | IO: controls <-> settings
import type { Pattern } from 'dj-controller'
import { DECKS, type DeckIndex } from '../../shared/decks.ts'
import type { Flx10 } from '../../shared/flx10.ts'
import { ledOut, showLights, type Plan } from '../../shared/lights/show-lights.ts'
import { changes, type Store } from '../../shared/store.ts'
import { follow } from '../../shared/streams.ts'
import type { TwinText } from '../../shared/twin-text.ts'
import { colourOf, EFFECTS, pressed, type ColorFx } from './rules.ts'

export type ColorFxState = { readonly selected: ColorFx | null; readonly colours: readonly [number, number] }

// MAN p.99: the pressed button flashes. ASSUMPTION: the loops' blink.
export const SELECTED_BLINK: Pattern<boolean> = { steps: [[true, 250], [false, 250]], repeat: true }

// MAN pp.99-101: the names on the buttons.
const NAMES: Readonly<Record<ColorFx, string>> = { space: 'SPACE', dubEcho: 'DUB ECHO', crush: 'CRUSH', pitch: 'PITCH', noise: 'NOISE', filter: 'FILTER' }

/** Each COLOR knob named on the twin by the effect it turns, its printed legend with none selected. */
export function labelKnobs(flx: Flx10, text: TwinText, state: Store<ColorFxState>, signal: AbortSignal): void {
  state.watch((s) => DECKS.forEach((d) => text.label(flx.mixer.channels[d].color, s.selected === null ? undefined : NAMES[s.selected])), signal)
}

export function playColorFx(flx: Flx10, state: Store<ColorFxState>, signal: AbortSignal): Promise<void>[] {
  const buttons = flx.effect.soundColor
  const show = showLights(signal)
  const plan = (selected: ColorFx | null): Plan => ({
    steady: EFFECTS.filter((e) => e !== selected).map((e) => ({ kind: 'led', out: ledOut(buttons[e]), value: false })),
    blinks: selected === null ? [] : [{ kind: 'led', name: `color-fx-${selected}`, out: ledOut(buttons[selected]), pattern: SELECTED_BLINK }],
  })
  const knob = (deck: DeckIndex) => {
    const control = flx.mixer.channels[deck].color
    const turned = (value: number) => state.update((s) => ({ ...s, colours: deck === 0 ? [colourOf(value / control.max), s.colours[1]] : [s.colours[0], colourOf(value / control.max)] }))
    if (control.value !== undefined) turned(control.value)
    return follow(control.changes({ signal }), turned, signal)
  }
  return [
    // MML p.3 F2-F7; their SHIFT layer has no function in MAN p.99.
    ...EFFECTS.map((effect) => follow(buttons[effect].presses({ signal }), (press) => (press.shift ? undefined : state.update((s) => ({ ...s, selected: pressed(s.selected, effect) }))), signal)),
    // MML p.3 F1; channels 3 and 4 have no deck.
    ...DECKS.map(knob),
    follow(changes(state, signal), (s) => show(plan(s.selected)), signal),
  ]
}
