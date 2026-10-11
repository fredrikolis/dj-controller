// Concern: a deck's beat grid in frames: its first beat, a beat, the song's end, a position snapped to its nearest beat, its beat phase | Non-concern: what snaps (features) | IO: (deck) -> grid
import { loopFrames } from '../beat-grid/beat-grid.ts'

export type Grid = { readonly first: number; readonly beat: number; readonly end: number }

// The songs start on beat 0 at a fixed BPM, so the grid is exact.
export const gridOf = (deck: { readonly song: { readonly bpm: number; readonly bars: number }; readonly sampleRate: number }): Grid => ({ first: 0, beat: (60 / deck.song.bpm) * deck.sampleRate, end: loopFrames(deck.song.bars, deck.song.bpm, deck.sampleRate) })

// ASSUMPTION: a 1-beat snap, a tie going up.
export const snapped = (quantize: boolean, position: number, grid: Grid): number => (quantize ? grid.first + Math.round((position - grid.first) / grid.beat) * grid.beat : position)

/** How far `position` is past the beat at or before it. */
export const beatPhase = (position: number, grid: Grid): number => (((position - grid.first) % grid.beat) + grid.beat) % grid.beat
