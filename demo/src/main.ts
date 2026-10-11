// Concern: the demo page: the desk, its songs, the basics' connection and twin, every feature in one list, hot cues kept in the URL | Non-concern: each feature's work | IO: (page, controller) -> audio
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
import { startSampler } from './features/sampler/actions.ts'
import { sampler } from './features/sampler/sampler.ts'
import { syncMaster } from './features/sync-master/sync-master.ts'
import { find } from './shared/dom.ts'
import { createDesk, type Desk } from './shared/engine/engine.ts'
import type { DeskView, Feature } from './shared/feature.ts'
import { audioFor, pageLife, reporter } from './shared/page.ts'
import { screenShift } from './shared/screen-shift.ts'
import type { Pair } from './shared/decks.ts'
import type { HotCues } from './shared/transport/hot-cue-state.ts'
import { beatFxStart, cuesOf, deskStart, layout, loopStart, samplerStart, withCues, type DeskStart, type LoopStart } from './shared/view.ts'

const signal = pageLife()
document.adoptedStyleSheets = [...document.adoptedStyleSheets, theme]
const query = new URLSearchParams(location.search)

/** Every FLX10 function the demo plays, each its own module; their on-screen controls appear in this order. */
const FEATURES: readonly Feature[] = [deckTransport, beatJump, masterTempo, keyShift, jog, syncMaster, loops, hotCues, memoryCues, padFx, beatFx(beatFxStart(query)), sampler, mixer]
const desk = find('#desk', HTMLElement, document)
const twin = find('dj-controller-twin', Twin, document)
const report = reporter(find('#error', HTMLElement, document), signal)
const view: DeskView = { decks: [find('[data-deck="0"]', HTMLElement, desk), find('[data-deck="1"]', HTMLElement, desk)], mixer: find('.mixer', HTMLElement, desk), effects: find('.effects', HTMLElement, desk), sampler: find('.sampler', HTMLElement, desk) }
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
    const sampler = samplerStart(query)
    if (sampler) startSampler(audio.sampler, sampler)
    const play: Play = async (controller, s) => {
      const playing = controller === null ? { controller, shifts: [screenShift(view.decks[0], s), screenShift(view.decks[1], s)] as const } : { controller, shifts: null }
      await Promise.all(FEATURES.map((feature) => feature({ desk: audio, view, signal: s, ...playing })))
    }
    const page = { button: find('#connect', HTMLButtonElement, document), twin, root: desk, report }
    await Promise.all([load(audio, deskStart(query), loopStart(query), cuesOf(query)), playConnected(page, play, signal)])
  } catch (err) {
    if (!signal.aborted) report(err)
  }
}

await start()
