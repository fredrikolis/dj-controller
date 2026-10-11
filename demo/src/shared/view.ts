// Concern: the page's view state as its URL query, one owner: the twin's layout, the decks' start, loop and hot cues | Non-concern: each view | IO: (query) <-> state
import type { Pair } from './decks.ts'
import { NO_HOT_CUES, slotName, type HotCue, type HotCues } from './transport/hot-cue-state.ts'

export type Layout = 'wide' | 'narrow'

/** `loading`: the songs never load; `playing`: both decks play once loaded. Paused when unset. */
export type DeskStart = 'loading' | 'playing'

export type LoopStart = 'pending' | 'active' | 'adjust' | 'stored'

const LAYOUTS: readonly Layout[] = ['wide', 'narrow']
const STARTS: readonly DeskStart[] = ['loading', 'playing']
const LOOPS: readonly LoopStart[] = ['pending', 'active', 'adjust', 'stored']

/** `?layout=wide` or `?layout=narrow` fixes the twin's layout; the page's width picks it otherwise. */
export const layout = (query: URLSearchParams): Layout | null => LAYOUTS.find((l) => l === query.get('layout')) ?? null

/** `?state=loading` or `?state=playing`. */
export const deskStart = (query: URLSearchParams): DeskStart | null => STARTS.find((s) => s === query.get('state')) ?? null

export const loopStart = (query: URLSearchParams): LoopStart | null => LOOPS.find((l) => l === query.get('loop')) ?? null

const CUE = /^([12])([A-P])(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?$/

const cueText = (cue: HotCue): string => (cue.kind === 'cue' ? String(cue.at) : `${cue.in}-${cue.out}`)

const cuesText = (decks: Pair<HotCues>): string =>
  decks.flatMap((cues, d) => cues.flatMap((cue, slot) => (cue ? [`${d + 1}${slotName(slot)}${cueText(cue)}`] : []))).join('_')

/** Null where unchanged. */
export function withCues(search: string, decks: Pair<HotCues>): string | null {
  const query = new URLSearchParams(search)
  const text = cuesText(decks)
  if ((query.get('cues') ?? '') === text) return null
  query.set('cues', text)
  return `?${query}`
}

export function cuesOf(query: URLSearchParams): Pair<HotCues> | null {
  const text = query.get('cues')
  if (text === null) return null
  const decks: [(HotCue | null)[], (HotCue | null)[]] = [[...NO_HOT_CUES], [...NO_HOT_CUES]]
  for (const entry of text === '' ? [] : text.split('_')) {
    const [, deck, slot, at, out] = CUE.exec(entry) ?? []
    if (deck === undefined || slot === undefined || at === undefined) return null
    const cue: HotCue = out === undefined ? { kind: 'cue', at: Number(at) } : { kind: 'loop', in: Number(at), out: Number(out) }
    if (cue.kind === 'loop' && cue.out <= cue.in) return null
    decks[Number(deck) - 1][slot.charCodeAt(0) - 65] = cue
  }
  return decks
}
