// Concern: what the main thread and a deck's audio-thread player say to each other, and the player's registered name | Non-concern: either side's work | IO: none
import type { LoopPoints } from './loop-state.ts'

export const PLAYER = 'deck-player'

/** In frames of the loaded song. */
export type PlayerMessage =
  | { readonly kind: 'load'; readonly song: Float32Array<ArrayBuffer>[] }
  /** Pitch kept, at `rate` of `render`'s tempo; null the loaded song, absent the render playing. */
  | { readonly kind: 'lock'; readonly render?: Float32Array<ArrayBuffer>[] | null; readonly rate: number }
  | { readonly kind: 'unlock' }
  | { readonly kind: 'play'; readonly on: boolean }
  | { readonly kind: 'reverse'; readonly on: boolean }
  | { readonly kind: 'hold'; readonly on: boolean }
  | { readonly kind: 'seek'; readonly frame: number }
  | { readonly kind: 'jog'; readonly frames: number }
  | { readonly kind: 'search'; readonly speed: number }
  | { readonly kind: 'loop'; readonly loop: LoopPoints | null }

export type PlayerReport = { readonly kind: 'position'; readonly position: number; readonly framesASecond: number } | { readonly kind: 'ended' }
