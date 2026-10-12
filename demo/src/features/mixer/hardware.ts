// Concern: the mixer on the FLX10: channels 1 and 2's TRIM, faders, EQ, assigns, fader start and the crossfader in; level meters out | Non-concern: the curves | IO: (controls) -> mix; levels -> meters
import type { Absolute, Button, Switch } from 'dj-controller'
import { DECKS, type DeckIndex, type Pair } from '../../shared/decks.ts'
import type { Flx10 } from '../../shared/flx10.ts'
import { ASSIGNS } from '../../shared/mixer/curves.ts'
import { BANDS, type Mixer } from '../../shared/mixer/mixer.ts'
import { logger } from '../../shared/logger.ts'
import { showEachFrame } from '../../shared/outputs.ts'
import { follow } from '../../shared/streams.ts'
import type { Deck } from '../../shared/transport/deck.ts'
import type { Move } from './fader-start.ts'
import { start } from './start.ts'

function position(control: Absolute, act: (position: number) => void, signal: AbortSignal): Promise<void> {
  if (control.value !== undefined) act(control.value / control.max)
  return follow(control.changes({ signal }), (value) => act(value / control.max), signal)
}

function channel(flx: Flx10, mixer: Mixer, decks: Pair<Deck>, deck: DeckIndex, signal: AbortSignal): Promise<void>[] {
  const controls = flx.mixer.channels[deck]
  const moved = (move: Move) => ({ on }: { readonly on: boolean }) => (on ? start(decks[deck], move) : undefined)
  const starts = controls.faderStart
  const assigns = ASSIGNS.map((assign) => {
    const side = controls.crossfaderAssign[assign]
    if (side.on) mixer.assign(deck, assign)
    return follow(
      side.changes({ signal }),
      ({ on }) => {
        if (on) mixer.assign(deck, assign)
      },
      signal,
    )
  })
  return [
    // MAN p.51 item 7, MML p.2 M3.
    position(controls.trim, (p) => mixer.trim(deck, p), signal),
    position(controls.fader, (p) => mixer.fader(deck, p), signal),
    ...BANDS.map((band) => position(controls.eq[band], (p) => mixer.eq(deck, band, p), signal)),
    ...assigns,
    // MML p.2 M1/M2, sent with SHIFT held (MAN p.91); unobserved. ASSUMPTION: 9n 5D, the list's +SHIFT row, starts as 9n 66; on is the move.
    follow(starts.leavesZero.changes({ signal }), moved('leaves-zero'), signal),
    follow(controls.shifted.faderStart.leavesZero.changes({ signal }), moved('leaves-zero'), signal),
    follow(starts.reachesZero.changes({ signal }), moved('reaches-zero'), signal),
  ]
}

type Strip = Flx10['mixer']['channels'][number]

/** Each mixer control the demo does not play (MAN pp.50-53), its moves under what the demo lacks for it. */
function leftOut(flx: Flx10, signal: AbortSignal): Readonly<Record<string, readonly AsyncIterable<unknown>[]>> {
  const { channels, headphones, mic, masterCue, samplerCue, masterLevel, boothLevel } = flx.mixer
  const moves = (control: Absolute | Switch) => control.changes({ signal })
  const presses = (button: Button<unknown>) => button.presses({ signal })
  // COLOR and SOUND COLOR FX are features/sound-color-fx; SAMPLER VOL the sampler's.
  const strip = (c: Strip) => [c.fader, c.trim, c.eq.hi, c.eq.mid, c.eq.low, c.color, ...Object.values(c.crossfaderAssign)].map(moves)
  return {
    'the demo has no deck 3 or 4': [...strip(channels[2]), ...strip(channels[3]), moves(channels[2].linePhono.line), moves(channels[3].linePhono.line)],
    'the demo has no external input and one computer (input select)': channels.flatMap((c) => Object.values(c.inputSelect).map(moves)),
    'the page has one stereo output: no PC HEADPHONE stream to mix a cue for (docs/research/flx10-audio.md)': [...channels.map((c) => presses(c.cue)), presses(masterCue), presses(samplerCue), moves(headphones.mix)],
    'the demo has no stems (FX PART SELECT; Part ISO is SHIFT+CH CUE)': Object.values(flx.effect.fxPart).map(presses),
    "the unit's own attenuators set its MASTER, BOOTH and PHONES outputs, after the computer's sound (MAN p.174)": [masterLevel, boothLevel, headphones.level].map(moves),
    "the unit's own microphone path (MAN p.174): the demo takes no microphone": [mic.off, mic.on, mic.talkover, mic.eq.hi, mic.eq.low].map(moves),
  }
}

/** Says once, at a group's first move, why nothing is heard of it. */
function explained(flx: Flx10, signal: AbortSignal): Promise<void>[] {
  return Object.entries(leftOut(flx, signal)).flatMap(([why, feeds]) => {
    let said = false
    const say = () => {
      if (!said) logger.note(`this mixer control is not played: ${why}`)
      said = true
    }
    return feeds.map((feed) => follow(feed, say, signal))
  })
}

// MAN p.108: the crossfader's curve is a rekordbox preference. ASSUMPTION: equal power.
export function playMixer(flx: Flx10, mixer: Mixer, decks: Pair<Deck>, signal: AbortSignal): Promise<void>[] {
  // The meter's scale is unobserved.
  const meters = () => DECKS.map((d) => ({ out: flx.mixer.channels[d].levelMeter, value: Math.round(mixer.level(d) * 127) }))
  return [...DECKS.flatMap((d) => channel(flx, mixer, decks, d, signal)), position(flx.mixer.crossfader, mixer.crossfader, signal), showEachFrame(meters, signal), ...explained(flx, signal)]
}
