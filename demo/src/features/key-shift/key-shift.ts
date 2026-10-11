// Concern: the key shift feature: each deck's key shifted, synced, reset and played as a keyboard from the FLX10 KEY SHIFT and KEYBOARD modes or the page | Non-concern: the rules | IO: handles -> decks
import './key-shift.css'
import { DECKS } from '../../shared/decks.ts'
import type { Feature } from '../../shared/feature.ts'
import { keyShiftOf } from './actions.ts'
import { playKeyShift, showKeyFormat } from './hardware.ts'
import { paintKeys, showKey, showKeyControls } from './screen.ts'

export const keyShift: Feature = async ({ desk, controller, shifts, view, signal }) => {
  const keys = [keyShiftOf(desk.decks, 0), keyShiftOf(desk.decks, 1)] as const
  for (const i of DECKS) showKey(view.decks[i], keys[i], signal)
  try {
    if (controller === null) {
      const controls = DECKS.map((i) => showKeyControls(view.decks[i], keys[i], shifts[i], signal))
      await Promise.all([paintKeys(controls.map((c) => c.area), signal), ...controls.map((c) => c.ahead)])
      return
    }
    await Promise.all([showKeyFormat(controller, signal), ...DECKS.flatMap((i) => playKeyShift(controller.decks[i], keys[i], signal))])
  } catch (err) {
    throw new Error('the key shift stopped', { cause: err })
  }
}
