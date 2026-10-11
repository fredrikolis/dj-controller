// Concern: one deck's beat jump on the FLX10: 4 BEAT JUMP ◀/▶, SHIFT, held, with the jog; BEAT JUMP pads in; pad colours, PAGE LEDs out | Non-concern: the rules, what lights | IO: controls <-> deck
import type { Flx10Deck } from '../../shared/flx10.ts'
import { followJog } from '../../shared/jog-turns.ts'
import { modeViewsOf, showLights } from '../../shared/lights/show-lights.ts'
import { follow } from '../../shared/streams.ts'
import type { Deck } from '../../shared/transport/deck.ts'
import { gridOf } from '../../shared/transport/grid.ts'
import { jump, search } from './actions.ts'
import { buttonBeats, padJump, searchFrames, type Direction } from './jump.ts'
import { planOf } from './lights.ts'

// MML D23/D24: a long press is its own note, released by its OFF.
function followButton(button: Flx10Deck['4BeatJump']['left'], direction: Direction, deck: Deck, signal: AbortSignal): Promise<void> {
  return follow(button.presses({ signal }), (press) => (press.layer === 'long-press' ? search(deck, direction, press.released, signal) : jump(deck, buttonBeats(press.shift), direction, press.time)), signal)
}

// The platter's turns with 4 BEAT JUMP held: their own layer (MML p.2 D3). Every tick in one read came on its latest tick's layer.
function followJogSearch(platter: Flx10Deck['jog']['platter'], deck: Deck, signal: AbortSignal): Promise<void> {
  const grid = gridOf(deck)
  return followJog(platter, platter.revolution, (turns, { latest }) => (latest?.layer === '4-beat-jump' && deck.state.state.loaded ? deck.jog(searchFrames(turns, grid)) : undefined), signal)
}

async function keepLights(controls: Flx10Deck, signal: AbortSignal): Promise<void> {
  const show = showLights(signal)
  // MML P1-P8, P13/P14: 9p 20-2F, SHIFT on p+1; 9n 26, 2E.
  const views = modeViewsOf(controls.modes.beatJump)
  const paint = () => show(planOf(views, controls.mode.mode === 'beatJump' ? (controls.mode.page ?? null) : null))
  const modes = controls.modeChanges({ signal })
  await paint()
  await follow(modes, paint, signal)
}

export function playBeatJump(controls: Flx10Deck, deck: Deck, signal: AbortSignal): Promise<void>[] {
  return [
    followButton(controls['4BeatJump'].left, -1, deck, signal),
    followButton(controls['4BeatJump'].right, 1, deck, signal),
    followJogSearch(controls.jog.platter, deck, signal),
    // ASSUMPTION: SHIFT+pad does nothing.
    ...controls.pads.map((pad) =>
      follow(
        pad.hits({ signal }),
        (hit) => {
          if (hit.mode !== 'beatJump' || hit.shift) return
          const { beats, direction } = padJump(hit.page, hit.pad)
          jump(deck, beats, direction, hit.time)
        },
        signal,
      ),
    ),
    keepLights(controls, signal),
  ]
}
