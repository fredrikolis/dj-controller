// Concern: one deck's key shift on the FLX10: KEY SYNC and its SHIFT, SHIFT+HOT CUE, both modes' pads in; pads, PAGE, KEY SYNC LEDs, the jog screen's key out | Non-concern: rules | IO: controls <-> deck
import type { ValueOut } from 'dj-controller'
import type { Flx10, Flx10Deck } from '../../shared/flx10.ts'
import { modeViewsOf, showLights } from '../../shared/lights/show-lights.ts'
import { showEachFrame, type Write } from '../../shared/outputs.ts'
import { changes, createStore } from '../../shared/store.ts'
import { follow } from '../../shared/streams.ts'
import type { KeyShift } from './actions.ts'
import { renderAhead } from './ahead.ts'
import { slotOf } from '../../shared/hot-cues/hot-cue.ts'
import { slotName } from '../../shared/transport/hot-cue-state.ts'
import type { TwinText } from '../../shared/twin-text.ts'
import { chosenCue, PAD_PITCHES, pitchOf } from './semitones.ts'
import { jogScreenKey, keyboardPlan, pitchPlan } from './lights.ts'

function labelled(out: ValueOut, label: string): number {
  const at = out.labels?.indexOf(label) ?? -1
  const low = out.range?.[0]
  if (at < 0 || low === undefined) throw new RangeError(`the jog screen has no value labelled ${label}: its labels are ${out.labels?.join(', ') ?? 'none'}`)
  return low + at
}

const pageIn = (controls: Flx10Deck, mode: 'keyShift' | 'keyboard'): number | null => (controls.mode.mode === mode ? (controls.mode.page ?? null) : null)

const semitones = (pitch: number): string => (pitch > 0 ? `+${pitch}` : pitch < 0 ? `−${-pitch}` : '0')

function keepLights(controls: Flx10Deck, keys: KeyShift, text: TwinText, signal: AbortSignal): Promise<void>[] {
  text.labelPads(controls.modes.keyShift, (page, pad) => semitones(pitchOf(page, pad)))
  const showKeyShift = showLights(signal)
  const showKeyboard = showLights(signal)
  // MML P1-P8 9p 70-7F and 40-4F, SHIFT on p+1; P13/P14 9n 2B/33, 28/30.
  const views = { keyShift: modeViewsOf(controls.modes.keyShift), keyboard: modeViewsOf(controls.modes.keyboard) }
  const pitches = createStore<readonly number[]>([])
  const seen = createStore(0)
  const bump = () => seen.update((n) => n + 1)
  keys.watch(bump, signal)
  const paint = async () => {
    const s = keys.deck.state.state
    const asked = keys.asked()
    const choosing = chosenCue(keys.chosen.state, s.hotCues) === null
    const shiftPage = pageIn(controls, 'keyShift')
    const keyboardPage = pageIn(controls, 'keyboard')
    const pitchPage = shiftPage ?? (choosing ? null : keyboardPage)
    // MAN p.84: Keyboard's pads choose a hot cue, then play it at their pitches.
    text.labelPads(controls.modes.keyboard, (page, pad) => (choosing ? slotName(slotOf(page, pad)) : semitones(pitchOf(page, pad))))
    pitches.update(() => (pitchPage === null ? [] : PAD_PITCHES.flatMap((page, p) => (p === pitchPage ? page : []))))
    await Promise.all([showKeyShift(pitchPlan(views.keyShift, asked, shiftPage)), showKeyboard(keyboardPlan(views.keyboard, s, asked, choosing, keyboardPage))])
  }
  return [follow(controls.modeChanges({ signal }), bump, signal), follow(changes(seen, signal), paint, signal), renderAhead(keys.deck, pitches, signal)]
}

function shown(controls: Flx10Deck, keys: KeyShift): Write[] {
  const s = keys.deck.state.state
  const { key, change } = jogScreenKey(s, keys.deck.song.key)
  return [
    // MML p.2 D8; SHIFT's dark as rekordbox writes it (flx10-connect.md frames 149-155).
    { led: controls.keySync, on: s.keySync },
    { led: controls.shifted.keySync, on: false },
    { out: controls.display.key, value: labelled(controls.display.key, key) },
    { out: controls.display.keyChange, value: labelled(controls.display.keyChange, change) },
  ]
}

export function playKeyShift(controls: Flx10Deck, keys: KeyShift, text: TwinText, signal: AbortSignal): Promise<void>[] {
  return [
    // MML p.2 D8: 9n 65, SHIFT 9n 64; the long press is master tempo's.
    follow(controls.keySync.presses({ signal }), (press) => (press.layer !== '' ? undefined : press.shift ? keys.reset() : keys.keySync()), signal),
    // MML p.6 P9, MAN p.84.
    follow(controls.padMode.hotCue.presses({ signal }), (press) => (press.shift && press.layer === '' ? keys.chooseAgain() : undefined), signal),
    // ASSUMPTION: SHIFT+pad does nothing in either mode.
    ...controls.pads.map((pad) =>
      follow(
        pad.hits({ signal }),
        (hit) => {
          if (hit.shift) return
          if (hit.mode === 'keyShift') keys.shiftPad(hit.page, hit.pad)
          else if (hit.mode === 'keyboard') keys.keyboardPad(hit.page, hit.pad, hit.time)
        },
        signal,
      ),
    ),
    ...keepLights(controls, keys, text, signal),
    showEachFrame(() => shown(controls, keys), signal),
  ]
}

// MML p.7 Key display format; ASSUMPTION: Classic, rekordbox's default.
export const showKeyFormat = (controller: Flx10, signal: AbortSignal): Promise<void> => showEachFrame(() => [{ out: controller.display.keyFormat, value: 0 }], signal)
