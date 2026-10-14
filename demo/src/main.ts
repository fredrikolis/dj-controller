// Concern: the demo page: the desk, its songs, the basics' controller and twin, every feature in one list, hot cues kept in the URL | Non-concern: each feature's work | IO: (page, controller) -> audio
import { Twin, theme, type TwinPanel, type TwinSection } from 'dj-controller/twin'
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
import { SONGS, type Song } from './shared/engine/songs.ts'
import type { Feature } from './shared/feature.ts'
import { audioFor, pageLife, reporter } from './shared/page.ts'
import { twinText } from './shared/twin-text.ts'
import type { Pair } from './shared/decks.ts'
import type { HotCues } from './shared/transport/hot-cue-state.ts'
import { keyName } from './shared/transport/key.ts'
import { cuesOf, deck2AsPads, deskStart, layout, loopStart, withCues, type DeskStart, type LoopStart } from './shared/view.ts'

const signal = pageLife()
document.adoptedStyleSheets = [...document.adoptedStyleSheets, theme]
const query = new URLSearchParams(location.search)

/** Every FLX10 function the demo plays, each its own module. */
const FEATURES: readonly Feature[] = [deckTransport, beatJump, masterTempo, keyShift, jog, syncMaster, loops, hotCues, memoryCues, padFx, beatFx, soundColorFx, sampler, mixer]
/** Deck 2 as its pads alone: its panel's free area is the page's. */
const DECK_2_AS_PADS: readonly TwinSection[] = ['deck 1/3', 'mixer', 'effects', 'deck 2/4 pads']

/** A song as the page's own content in `panel`'s free area: its title, tempo and key, and the layers it is made of. */
function songCard(panel: TwinPanel, song: Song): HTMLElement {
  const card = document.createElement('section')
  card.slot = panel
  card.className = 'song'
  const title = document.createElement('h2')
  title.textContent = song.title
  const tempo = document.createElement('p')
  tempo.textContent = `${song.bpm} BPM, ${keyName(song.key)}`
  const layers = document.createElement('ul')
  layers.append(...song.layers.map(({ name }) => Object.assign(document.createElement('li'), { textContent: name })))
  card.append(title, tempo, layers)
  return card
}

const twin = deck2AsPads(query) ? new Twin({ sections: DECK_2_AS_PADS }) : new Twin()
if (deck2AsPads(query)) twin.append(songCard('deck 2/4', SONGS[1]))
document.body.append(twin)
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
