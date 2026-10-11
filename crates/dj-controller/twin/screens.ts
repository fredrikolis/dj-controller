// Concern: draws a jog's screen and a text display and writes what each shows: told outputs, a host's text | Non-concern: where values come from (follow.ts) | IO: (svg, part) -> nodes; (values) -> text
import type { BeatFxText, JogText } from '../index.js'
import { fit } from './labels.js'
import type { Part } from './types.js'

const SVG = 'http://www.w3.org/2000/svg'

export type JogShown = {
  readonly bpm?: number
  readonly speed?: number
  readonly minutes?: number
  readonly seconds?: number
  readonly remaining?: number
  readonly key?: string
  readonly keyChange?: string
  readonly masterTempo?: number
  readonly master?: number
  readonly sync?: number
  readonly marker?: number
  readonly cue?: number
  readonly hidden?: number
}

export type ScreenNodes = Readonly<Record<string, SVGElement>>

function text(g: SVGGElement, field: string, x: number, y: number, size: number, cls = ''): SVGElement {
  const node = document.createElementNS(SVG, 'text')
  for (const [k, v] of Object.entries({ x, y, 'font-size': size, class: `shown ${cls}`.trim(), 'data-field': field })) node.setAttribute(k, String(v))
  g.append(node)
  return node
}

function mark(g: SVGGElement, cls: string, x: number, y: number, r: number): SVGElement {
  const node = document.createElementNS(SVG, 'path')
  node.setAttribute('d', `M${x} ${y - r + 3}v9`)
  node.setAttribute('class', cls)
  g.append(node)
  return node
}

/** A jog screen's fields, laid out as the unit's Deck Info mode names them (MAN pp.33-35), proportions approximate. */
export function drawJog(g: SVGGElement, part: Part): ScreenNodes {
  const { x, y } = part
  const r = typeof part.size === 'number' ? part.size : part.size[0] / 2
  return {
    marker: mark(g, 'marker', x, y, r),
    cue: mark(g, 'cue', x, y, r),
    deck: text(g, 'deck', x, y - 64, 11, 'dim'),
    bpm: text(g, 'bpm', x, y - 34, 30, 'big'),
    range: text(g, 'range', x - 38, y - 6, 13, 'dim'),
    speed: text(g, 'speed', x + 22, y - 6, 13),
    key: text(g, 'key', x - 34, y + 18, 15),
    keyChange: text(g, 'keyChange', x + 4, y + 18, 13, 'dim'),
    masterTempo: text(g, 'masterTempo', x + 42, y + 18, 11, 'flag'),
    time: text(g, 'time', x, y + 42, 15),
    master: text(g, 'master', x - 24, y + 62, 10, 'flag'),
    sync: text(g, 'sync', x + 26, y + 62, 10, 'flag'),
  }
}

const signed = (n: number, digits: number): string => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n).toFixed(digits)}`
const two = (n: number): string => String(n).padStart(2, '0')
/** MML p.7: a cue point of both halves 0x7F is hidden. */
const CUE_HIDDEN = 0x3fff

export function paintJog(part: Part, nodes: ScreenNodes, shown: JogShown, deck: string, host: JogText | undefined): void {
  const off = shown.hidden !== undefined && shown.hidden > 0
  const write = (field: string, value: string | undefined) => (nodes[field].textContent = off ? '' : (value ?? ''))
  const flag = (field: string, label: string, on: number | undefined) => {
    nodes[field].textContent = off ? '' : label
    nodes[field].classList.toggle('on', on !== undefined && on > 0)
  }
  write('deck', `DECK ${deck}`)
  write('bpm', shown.bpm?.toFixed(1))
  write('range', host?.range)
  write('speed', shown.speed === undefined ? undefined : `${signed(shown.speed, 1)}%`)
  write('key', shown.key)
  write('keyChange', shown.keyChange)
  write('time', shown.minutes === undefined || shown.seconds === undefined ? undefined : `${shown.remaining ? '−' : ''}${two(shown.minutes)}:${two(shown.seconds)}`)
  flag('masterTempo', 'MT', shown.masterTempo)
  flag('master', 'MASTER', shown.master)
  flag('sync', 'SYNC', shown.sync)
  const turn = (field: string, degrees: number | undefined) => {
    nodes[field].toggleAttribute('hidden', off || degrees === undefined)
    nodes[field].style.display = off || degrees === undefined ? 'none' : ''
    if (degrees !== undefined) nodes[field].setAttribute('transform', `rotate(${degrees} ${part.x} ${part.y})`)
  }
  turn('marker', shown.marker)
  turn('cue', shown.cue === CUE_HIDDEN ? undefined : shown.cue)
}

/** The Beat FX display's fields as the unit's shows them (MAN p.92): effect, beat or parameter, AUTO or TAP with the BPM, channel. */
export function drawDisplay(g: SVGGElement, part: Part): ScreenNodes {
  const { x, y } = part
  const h = typeof part.size === 'number' ? part.size * 2 : part.size[1]
  const row = (n: number) => y - h / 2 + (h / 4) * (n + 0.5)
  return { name: text(g, 'name', x, row(0), 12), beat: text(g, 'beat', x, row(1) + 2, 22, 'big'), bpm: text(g, 'bpm', x, row(2) + 4, 12), channel: text(g, 'channel', x, row(3) + 2, 12, 'dim') }
}

export function paintDisplay(part: Part, nodes: ScreenNodes, channel: string | undefined, host: BeatFxText | undefined): void {
  const w = typeof part.size === 'number' ? part.size * 2 : part.size[0]
  const name = host === undefined || host.name === '' ? undefined : fit(host.name, w * 0.94, 1, 12, 8)
  nodes.name.textContent = name?.lines[0] ?? ''
  if (name) nodes.name.setAttribute('font-size', String(name.size))
  nodes.beat.textContent = host?.beat ?? ''
  nodes.bpm.textContent = host === undefined ? '' : `${host.tap ? 'TAP' : 'AUTO'} ${host.bpm === undefined ? '---.-' : host.bpm.toFixed(1)}`
  nodes.channel.textContent = channel ?? ''
}
