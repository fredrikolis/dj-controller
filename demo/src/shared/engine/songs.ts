// Concern: the demo's two songs as SVA compositions: published slopbank loops layered into one node each, timed in bars | Non-concern: rendering them (render.ts) | IO: (song) -> nodes
import { BEATS_PER_BAR, barred, secsPerBar } from '../beat-grid/beat-grid.ts'
import type { Key } from '../transport/key.ts'

// Slopbank's home-soundtrack set: 144 BPM in D minor, so the songs mix.
type Closure = Readonly<Record<string, string>>

const CLOSURES: Readonly<Record<string, Closure>> = import.meta.glob('../../../songs/*.json', { eager: true, import: 'default' })

export type Layer = { readonly name: string; readonly hash: string; readonly gain: number; readonly bars: number }

export type Song = { readonly title: string; readonly bpm: number; readonly key: Key; readonly bars: number; readonly layers: readonly Layer[] }

// Their voices bound at D (f0 73.42, 146.83, 587.33 Hz) over F, A, B♭, C.
const D_MINOR: Key = { tonic: 2, minor: true }

export const ROOT = 'song'

export const SONGS: readonly [Song, Song] = [
  {
    title: 'Halftime drop',
    bpm: 144,
    key: D_MINOR,
    bars: 8,
    layers: [
      { name: 'halftime drums', hash: 'b098bcd36565206532bc8a6202c3903a6988b982aabc36f8d1498e9fdb67ac4d', gain: 0.7, bars: 8 },
      { name: 'growl bass riff', hash: '4a2cce443dc08c5f70ce6a155e60354bbd161c4132898268e39171d66571b04c', gain: 0.7, bars: 8 },
    ],
  },
  {
    title: 'Cracktro',
    bpm: 144,
    key: D_MINOR,
    bars: 8,
    layers: [
      { name: 'cracktro arp and bass', hash: '8631c2ff0bc5e4ecbe0ab993608386127c6debe34930fab47f4faf3170327bbb', gain: 1.2, bars: 8 },
      { name: 'cracktro chip drums', hash: '168d5c88f3a5e587f494ce52314eeb4154b4a5474c1620327891df88a8ad6770', gain: 1.3, bars: 2 },
      { name: 'cracktro chip melody', hash: 'd741edd4a9aaee81cea92974cd375b5c3a013bcdfaad605325a39f81ed6b08a7', gain: 1.6, bars: 8 },
    ],
  },
]

function closureOf(layer: Layer): Closure {
  const closure = CLOSURES[`../../../songs/${layer.hash}.json`]
  if (!closure) throw new Error(`songs/${layer.hash}.json is missing`)
  return closure
}

/** The root sums the layers, each repeated to the song's length. */
export function nodes(song: Song): [path: string, text: string][] {
  const bar = secsPerBar(song.bpm)
  const sounds = song.layers.flatMap((l) => Object.entries(closureOf(l)).map(([hash, text]): [string, string] => [`sva${hash}`, barred(text, bar)]))
  const terms = song.layers.flatMap((l) => Array.from({ length: song.bars / l.bars }, (_, i) => `${l.gain}*@sva${l.hash}(${i === 0 ? 't' : `t - ${i * l.bars}b`})`))
  return [...sounds, [ROOT, terms.join(' + ')], ['variables/meter', `${BEATS_PER_BAR}/4`]]
}
