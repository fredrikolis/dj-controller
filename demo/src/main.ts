// Concern: the demo page: the desk, its songs, the basics' controller and twin, every feature in one list, hot cues kept in the URL | Non-concern: each feature's work | IO: (page, controller) -> audio
import { Twin, theme } from 'dj-controller/twin'
import { playConnected, type Play } from './basics.ts'
import { beatFx } from './features/beat-fx/beat-fx.ts'
import { beatJump } from './features/beat-jump/beat-jump.ts'
import { deckTransport } from './features/deck-transport/deck-transport.ts'
import { startCues } from './shared/hot-cues/actions.ts'
import { hotCues } from './features/hot-cues/hot-cues.ts'
import { jog } from './features/jog/jog.ts'
import { keyShift } from './features/key-shift/key-shift.ts'
import { startLoop } from './features/loops/actions.ts'
import { loops } from './features/loops/loops.ts'
import { masterTempo } from './features/master-tempo/master-tempo.ts'
import { memoryCues } from './features/memory-cues/memory-cues.ts'
import { mixer } from './features/mixer/mixer.ts'
import { padFx } from './features/pad-fx/pad-fx.ts'
import { sampler } from './features/sampler/sampler.ts'
import { soundColorFx } from './features/sound-color-fx/sound-color-fx.ts'
import { syncMaster } from './features/sync-master/sync-master.ts'
import { find } from './shared/dom.ts'
import { createDesk, type Desk } from './shared/engine/engine.ts'
import type { Feature } from './shared/feature.ts'
import { audioFor, pageLife, reporter } from './shared/page.ts'
import { twinText } from './shared/twin-text.ts'
import type { Pair } from './shared/decks.ts'
import type { HotCues } from './shared/transport/hot-cue-state.ts'
import { cuesOf, deskStart, layout, loopStart, withCues, type DeskStart, type LoopStart } from './shared/view.ts'

const signal = pageLife()
document.adoptedStyleSheets = [...document.adoptedStyleSheets, theme]
const query = new URLSearchParams(location.search)

/** Every FLX10 function the demo plays, each its own module. */
const FEATURES: readonly Feature[] = [deckTransport, beatJump, masterTempo, keyShift, jog, syncMaster, loops, hotCues, memoryCues, padFx, beatFx, soundColorFx, sampler, mixer]
const twin = find('dj-controller-twin', Twin, document)
const report = reporter(find('#error', HTMLElement, document), signal)
const fixed = layout(query)
if (fixed) twin.setAttribute('layout', fixed)

/** `?cues=` follows both decks' hot cues, so reloading the page keeps them for the session. */
function keepCuesInQuery(audio: Desk): void {
  const write = () => {
    const search = withCues(location.search, [audio.decks[0].state.state.hotCues, audio.decks[1].state.state.hotCues])
    if (search !== null) history.replaceState(history.state, '', `${location.pathname}${search}${location.hash}`)
  }
  for (const deck of audio.decks) deck.state.watch(write, signal)
}

/** Both songs loaded, their hot cues set, then looped and played if the URL asks; never with `?state=loading`. */
async function load(audio: Desk, start: DeskStart | null, loop: LoopStart | null, cues: Pair<HotCues> | null): Promise<void> {
  if (start === 'loading') return
  await Promise.all(
    audio.decks.map(async (deck, i) => {
      await deck.load(signal)
      if (cues) startCues(deck, cues[i])
      if (loop) startLoop(deck, loop)
      if (start === 'playing') deck.update({ playing: true })
    }),
  )
  keepCuesInQuery(audio)
}

async function start(): Promise<void> {
  try {
    const audio = await createDesk(audioFor(signal), signal)
    const play: Play = async (controller, s) => {
      const text = twinText(twin, s)
      await Promise.all(FEATURES.map((feature) => feature({ desk: audio, controller, text, signal: s })))
    }
    const page = { button: find('#connect', HTMLButtonElement, document), twin, report }
    await Promise.all([load(audio, deskStart(query), loopStart(query), cuesOf(query)), playConnected(page, play, signal)])
  } catch (err) {
    if (!signal.aborted) report(err)
  }
}

await start()
