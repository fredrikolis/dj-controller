// Concern: <dj-controller-twin>: a controller's panel from its layout, following each control's stream while it lives, a held part lit | Non-concern: drawing, following | IO: (controller) -> SVG
import { draw, el, type View } from './draw.js'
import { follow, initial, type State } from './follow.js'
import type { Button, TwinDisplays, TwinLabelled, VirtualGestures } from '../index.js'
import { checkedText } from './displays.js'
import { hands, type Point } from './gestures.js'
import { checked } from './labels.js'
import { layoutOf, place, placed, type Twinned } from './layout.js'
import type { Layout, Part } from './types.js'
import { logger } from './logger.js'
import { holdable, playable } from './hold.js'
import { flash, paint, type Rgb, type Told } from './paint.js'
import { styles } from './styles.js'
import { showing, shownOf, tree, type Seat, type Tree } from './tree.js'

const NARROW = '(orientation: portrait), (max-width: 899px)'
const JOGS = ['jog1', 'jog2', 'jog3', 'jog4'] as const

type Texts = { readonly [D in keyof TwinDisplays]?: TwinDisplays[D] }

export class Twin extends HTMLElement {
  static observedAttributes = ['layout']
  #controller: Twinned | null = null
  #tree: Tree = { seats: new Map(), owners: [] }
  #given: ReadonlyMap<TwinLabelled, string> = new Map()
  /** `#given` by any handle: a bank view, or a control whose plain layer is no pad mode's bank. */
  #labels: ReadonlyMap<object, string> = new Map()
  #texts: Texts = {}
  #repaint: () => void = () => {}
  #life: AbortController | null = null
  #running: Promise<void> = Promise.resolve()
  #shadow = this.attachShadow({ mode: 'open' })

  constructor() {
    super()
    this.#shadow.adoptedStyleSheets = [styles]
  }

  /** The controller drawn; null draws nothing. */
  get controller(): Twinned | null {
    return this.#controller
  }

  set controller(controller: Twinned | null) {
    this.#controller = controller
    this.#tree = controller ? tree(controller) : { seats: new Map(), owners: [] }
    this.#index()
    this.#start()
  }

  get labels(): ReadonlyMap<TwinLabelled, string> {
    return this.#given
  }

  set labels(labels: ReadonlyMap<TwinLabelled, string>) {
    for (const [control, text] of labels) {
      checked(text)
      const seat = this.#tree.seats.get(control)
      if (seat?.banked && seat.control === control) throw new RangeError('a pad with a bank for each pad mode and page names no one bank: label its bank views')
    }
    this.#given = new Map(labels)
    this.#index()
    this.#repaint()
  }

  /** `#given` by handle on the controller drawn: a key its tree seats is a control; any other is a selector's group, each position in it standing for it. */
  #index(): void {
    const { seats } = this.#tree
    const byHandle = new Map<object, string>(this.#given)
    for (const [key, text] of this.#given) {
      if (seats.has(key)) continue
      for (const position of Object.values(key).flat()) if (typeof position === 'object' && position !== null && seats.has(position)) byHandle.set(position, text)
    }
    this.#labels = byHandle
  }

  get texts(): Texts {
    return this.#texts
  }

  set texts(texts: Texts) {
    const beatFx = texts.beatFx && checkedText('beatFx', texts.beatFx)
    const jogs = JOGS.map((id) => texts[id] && checkedText(id, texts[id]))
    this.#texts = { beatFx, jog1: jogs[0], jog2: jogs[1], jog3: jogs[2], jog4: jogs[3] }
    this.#repaint()
  }

  /** What a host shows on `part`'s `at`th control now: the label of its bank showing, SHIFT's while held where it has one; a display's text. */
  #told(part: Part, at: number): Told {
    if (part.shape === 'display') return { beatFx: this.#texts[part.id] }
    if (part.shape === 'jog') return { jog: this.#texts[part.screens[at].id] }
    if (part.shape === 'selector') return { label: part.positions.map((p) => this.#labels.get(p.on)).find((text) => text !== undefined) }
    const seat: Seat | undefined = part.shape === 'passive' ? undefined : this.#tree.seats.get(part.controls[at].control)
    if (!seat) return {}
    const shown = shownOf(seat, this.#tree.owners)
    const bank = (shift: boolean) => showing(seat, shown, shift)
    const label = (handle: object | undefined) => (handle ? this.#labels.get(handle) : undefined)
    return { label: (shown.shift ? label(bank(true)) : undefined) ?? label(bank(false)) }
  }

  /** Settles once the twin stops following, by disconnection, a new controller, or the controller closing. */
  get running(): Promise<void> {
    return this.#running
  }

  connectedCallback(): void {
    this.#start()
  }

  disconnectedCallback(): void {
    this.#life?.abort()
    this.#life = null
  }

  attributeChangedCallback(): void {
    if (this.#life) this.#start()
  }

  #start(): void {
    this.#life?.abort()
    this.#life = null
    this.#shadow.replaceChildren()
    if (!this.isConnected || !this.#controller) return
    const life = new AbortController()
    this.#life = life
    this.#running = this.#run(this.#controller, life.signal)
  }

  async #run(controller: Twinned, signal: AbortSignal): Promise<void> {
    // One stream failing stops them all, so the panel never shows some controls live and others frozen.
    const stop = new AbortController()
    const following = AbortSignal.any([signal, stop.signal])
    try {
      const layout = layoutOf(controller)
      const parts = place(layout)
      // Which narrow panel each part sits in; a part outside them all is the layout's error.
      const homes = parts.map((part) => layout.narrow.findIndex(([x, y, w, h]) => part.x >= x && part.x < x + w && part.y >= y && part.y < y + h))
      const lost = parts.findIndex((_, i) => homes[i] < 0)
      if (lost >= 0) throw new RangeError(`part ${lost} lies outside every narrow panel`)
      const rgb: Rgb = (n) => controller.palette?.colour(n)?.rgb
      const states = parts.map((part) => placed(part).map(initial))
      const views: View[][] = parts.map(() => [])
      const inControls = new Set<unknown>(parts.flatMap((part) => placed(part).map(({ inControl }) => inControl)))
      const dirty = new Set<number>()
      let frame = 0
      signal.addEventListener('abort', () => cancelAnimationFrame(frame), { once: true })
      // Each hold's one record: the control it lit, so its release unlights that one whichever deck is in control now.
      const holds = new Map<number, number>()
      const hold = (i: number, at: number | undefined) => {
        if (at === undefined) holds.delete(i)
        else holds.set(i, at)
        repaint(i)
        if (stale && holds.size === 0) render()
      }
      const shown = (i: number) => active(parts[i])
      const repaint = (i: number) => {
        dirty.add(i)
        frame ||= requestAnimationFrame(() => {
          frame = 0
          for (const d of dirty) if (states[d].length) for (const view of views[d]) paint(parts[d], view, { ...states[d][shown(d)], held: holds.get(d) === shown(d) }, rgb, this.#told(parts[d], shown(d)))
          dirty.clear()
        })
      }
      const light = async (i: number, held: boolean): Promise<void> => {
        const part = parts[i]
        const at = held ? shown(i) : holds.get(i)
        if (!lights(part) || at === undefined || holds.has(i) === held) return
        const { control } = part.controls[at]
        if (!('led' in control)) return
        const before = holds.get(i)
        hold(i, held ? at : undefined)
        try {
          await control.led(held)
        } catch (error) {
          hold(i, before)
          throw error
        }
      }
      // A render's listeners live until the next replaces its nodes, which waits for the last hold's release.
      let drawn = new AbortController()
      let stale = false
      const render = () => {
        stale = holds.size > 0
        if (stale) return
        drawn.abort()
        drawn = new AbortController()
        this.#render(layout, parts, homes, views, light, AbortSignal.any([signal, drawn.signal]), () => parts.forEach((_, i) => repaint(i)))
      }
      matchMedia(NARROW).addEventListener('change', render, { signal })
      render()
      const all = () => parts.forEach((_, i) => repaint(i))
      this.#repaint = all
      signal.addEventListener('abort', () => (this.#repaint = () => {}), { once: true })
      // A label follows its owner's pad mode, page and SHIFT.
      const moded = this.#tree.owners.map(async (owner) => {
        for await (const _ of owner.modeChanges({ signal: following })) all()
      })
      const followed = parts.flatMap((part, i) =>
        placed(part).map(({ control }, j) =>
          follow(part, j, following, {
            set: (patch: Partial<State>) => {
              states[i][j] = { ...states[i][j], ...patch }
              if (inControls.has(control)) parts.forEach((_, k) => repaint(k))
              else repaint(i)
            },
            flash: (shift: boolean) => j === shown(i) && views[i].forEach((view) => flash(view, shift)),
          }),
        ),
      )
      await Promise.all([...followed, ...moded])
    } catch (error) {
      stop.abort()
      if (signal.aborted) return
      logger.error('the twin stopped following its controller', error)
      this.dispatchEvent(new ErrorEvent('error', { error, message: String(error) }))
    }
  }

  #render(layout: Layout, parts: Part[], homes: number[], views: View[][], light: (i: number, held: boolean) => Promise<void>, signal: AbortSignal, all: () => void): void {
    const mode = this.getAttribute('layout') ?? (matchMedia(NARROW).matches ? 'narrow' : 'wide')
    const boxes = mode === 'narrow' ? layout.narrow : [layout.view]
    const controller = this.#controller
    const unit: VirtualGestures | undefined = controller && 'virtual' in controller ? controller.virtual : undefined
    this.#shadow.replaceChildren(...boxes.map(([x, y, w, h]) => el(null, 'svg', { viewBox: `${x} ${y} ${w} ${h}`, part: 'panel', role: 'group', 'aria-label': controller?.model ?? '' })))
    const panels = [...this.#shadow.querySelectorAll('svg')]
    // The SHIFT a part plays under: its section's, else the layout's first.
    const shifts = parts.filter((part) => part.shape === 'button' && part.latches)
    const shiftOf = (part: Part): Button<unknown> | undefined => {
      const shift = shifts.find((s) => s.section === part.section) ?? shifts[0]
      return shift?.shape === 'button' ? shift.controls[active(shift)].control : undefined
    }
    parts.forEach((part, i) => {
      views[i] = panels.map((svg) => draw(svg, part))
      const name = [part.section, part.name ?? part.label ?? part.shape].filter(Boolean).join(' ')
      // Only the panel a part sits in offers it; its copies the other panels clip are not there to reach.
      const home = mode === 'narrow' ? homes[i] : 0
      // Each part by its name, for a page's own selectors and tests.
      views[i].forEach(({ g }) => g.setAttribute('data-part', name))
      const offer = (make: (g: SVGGElement, svg: SVGSVGElement) => void) => views[i].forEach(({ g }, k) => (k === home ? make(g, panels[k]) : g.setAttribute('aria-hidden', 'true')))
      if (unit) {
        const seat = part.shape === 'passive' ? undefined : this.#tree.seats.get(part.controls[0]?.control ?? part)
        const played = hands(part, {
          unit,
          shown: () => active(part),
          shift: () => shiftOf(part),
          shifted: () => (seat ? shownOf(seat, this.#tree.owners).shift : false),
          later: (ms, run) => {
            const timer = setTimeout(run, ms)
            return () => clearTimeout(timer)
          },
        })
        if (played) offer((g, svg) => playable(g, name, played, (e) => point(svg, e), signal))
      } else if (lights(part)) offer((g) => holdable(g, name, (held) => light(i, held), signal))
    })
    this.#shadow.append(this.#fullscreen(signal))
    all()
  }

  #fullscreen(signal: AbortSignal): HTMLButtonElement {
    const button = document.createElement('button')
    button.part.add('fullscreen')
    button.textContent = document.fullscreenElement === this ? 'exit full screen' : 'full screen'
    button.addEventListener(
      'click',
      async () => {
        try {
          await (document.fullscreenElement === this ? document.exitFullscreen() : this.requestFullscreen())
        } catch (error) {
          logger.error('the twin could not change full screen', error)
        }
      },
      { signal },
    )
    document.addEventListener('fullscreenchange', () => (button.textContent = document.fullscreenElement === this ? 'exit full screen' : 'full screen'), { signal })
    return button
  }
}

/** Which of a part's controls it shows: the first whose deck is in control, else the first. */
function active(part: Part): number {
  return Math.max(0, placed(part).findIndex(({ inControl }) => inControl?.on === true))
}

/** Whether a part is a button with an LED the twin lights while it is held. */
function lights(part: Part): part is Part & { shape: 'button' | 'round' | 'touch' } {
  return (part.shape === 'button' || part.shape === 'round' || part.shape === 'touch') && part.controls.some(({ control }) => 'led' in control)
}

/** A pointer's place in `svg`'s own units. */
function point(svg: SVGSVGElement, e: PointerEvent): Point {
  const matrix = svg.getScreenCTM()
  if (!matrix) throw new TypeError('the twin\'s panel is not rendered')
  const { x, y } = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse())
  return { x, y }
}
