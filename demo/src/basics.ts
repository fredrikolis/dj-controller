// Concern: the shortest complete use of dj-controller: a virtual controller, connect, PLAY, CUE, TEMPO, faders, crossfader, the twin | Non-concern: the full desk (features/) | IO: (controller) -> audio
import { connect, virtual, type Absolute, type CloseReason } from 'dj-controller'
import { Twin, theme } from 'dj-controller/twin'
import { find } from './shared/dom.ts'
import { DECKS } from './shared/decks.ts'
import { createDesk, type Desk } from './shared/engine/engine.ts'
import { MODEL, type Flx10, type Flx10Deck } from './shared/flx10.ts'
import { logger } from './shared/logger.ts'
import { audioFor, pageLife, reporter } from './shared/page.ts'
import type { Deck } from './shared/transport/deck.ts'

/** Plays the desk from `controller` until `signal` aborts or it closes. */
export type Play = (controller: Flx10, signal: AbortSignal) => Promise<void>

export type ConnectPage = { readonly button: HTMLButtonElement; readonly twin: Twin; readonly report: (err: unknown) => void }

async function reporting(work: Promise<void>, report: (err: unknown) => void): Promise<void> {
  try {
    await work
  } catch (err) {
    report(err)
  }
}

function clicked(button: HTMLButtonElement, signal: AbortSignal): Promise<void> {
  button.disabled = false
  return new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    button.addEventListener('click', () => resolve(), { once: true, signal })
  })
}

async function closed(flx: Flx10): Promise<void> {
  try {
    await flx.close()
  } catch (err) {
    logger.error('the controller did not close', err)
  }
}

/** Plays a virtual FLX10 on the twin, by pointer and keys, until the button connects a real one: a failed connect is reported and the button offered again. */
async function untilConnected(page: ConnectPage, play: Play, signal: AbortSignal): Promise<Flx10 | null> {
  const offline = new AbortController()
  const unplugged = await virtual(MODEL, { signal })
  page.twin.controller = unplugged
  page.button.hidden = false
  const running = reporting(play(unplugged, AbortSignal.any([signal, offline.signal])), page.report)
  try {
    for (;;) {
      await clicked(page.button, signal)
      page.button.disabled = true
      try {
        return await connect(MODEL, { signal })
      } catch (err) {
        if (signal.aborted) return null
        page.report(err)
      }
    }
  } catch (err) {
    if (!signal.aborted) page.report(err)
    return null
  } finally {
    offline.abort()
    await running
    await closed(unplugged)
  }
}

async function closing(flx: Flx10, session: AbortController): Promise<CloseReason> {
  try {
    return await flx.closed
  } finally {
    session.abort()
  }
}

async function whileConnected(page: ConnectPage, flx: Flx10, play: Play, signal: AbortSignal): Promise<void> {
  const session = new AbortController()
  page.twin.controller = flx
  page.button.hidden = true
  try {
    const [reason] = await Promise.all([closing(flx, session), play(flx, AbortSignal.any([signal, session.signal]))])
    if (reason === 'unplugged') page.report(new Error(`the ${flx.model} is unplugged`))
  } catch (err) {
    if (!signal.aborted) page.report(new Error(`the ${flx.model} stopped`, { cause: err }))
  } finally {
    session.abort()
    await closed(flx)
  }
}

/** Plays a virtual FLX10 on the twin, then each real one the button connects while it stays, the same `play` on both. */
export async function playConnected(page: ConnectPage, play: Play, signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    const flx = await untilConnected(page, play, signal)
    if (flx) await whileConnected(page, flx, play, signal)
  }
}

// A press carries the SHIFT the FLX10 sent it with; rekordbox gives SHIFT+PLAY nothing (manual p.19).
async function playPause(controls: Flx10Deck, deck: Deck, signal: AbortSignal): Promise<void> {
  for await (const press of controls.playPause.presses({ signal })) {
    if (press.shift) continue
    deck.update({ playing: !deck.state.state.playing })
    await controls.playPause.led(deck.state.state.playing)
  }
}

// SHIFT+CUE returns to the start, playing on (manual p.19).
async function cue(controls: Flx10Deck, deck: Deck, signal: AbortSignal): Promise<void> {
  for await (const press of controls.cue.presses({ signal })) {
    deck.seek(0)
    if (press.shift) continue
    deck.update({ playing: false })
    await controls.playPause.led(false)
  }
}

/** From 0 to 1: now, if reported, then the latest at each change. */
async function fader(control: Absolute, set: (position: number) => void, signal: AbortSignal): Promise<void> {
  if (control.value !== undefined) set(control.value / control.max)
  for await (const value of control.changes({ signal })) set(value / control.max)
}

async function playBasics(flx: Flx10, desk: Desk, signal: AbortSignal): Promise<void> {
  const decks = DECKS.flatMap((i) => [
    playPause(flx.decks[i], desk.decks[i], signal),
    cue(flx.decks[i], desk.decks[i], signal),
    // Higher is faster (docs/research/flx10-observed-tempo.md).
    fader(flx.decks[i].tempo, (tempo) => desk.decks[i].update({ tempo }), signal),
    fader(flx.mixer.channels[i].fader, (p) => desk.mixer.fader(i, p), signal),
  ])
  try {
    await Promise.all([...decks, fader(flx.mixer.crossfader, desk.mixer.crossfader, signal)])
  } catch (err) {
    if (!signal.aborted) throw err
  }
}

/** Both songs unlocked, so TEMPO sets speed and pitch. */
export async function startBasics(): Promise<void> {
  const signal = pageLife()
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, theme]
  const report = reporter(find('#error', HTMLElement, document), signal)
  const page: ConnectPage = { button: find('#connect', HTMLButtonElement, document), twin: find('dj-controller-twin', Twin, document), report }
  try {
    const desk = await createDesk(audioFor(signal), signal)
    await Promise.all(desk.decks.map((deck) => deck.load(signal)))
    for (const deck of desk.decks) {
      deck.update({ masterTempo: false })
      deck.unlock()
    }
    await playConnected(page, (flx, s) => playBasics(flx, desk, s), signal)
  } catch (err) {
    if (!signal.aborted) report(err)
  }
}
