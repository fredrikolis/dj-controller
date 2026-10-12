// Concern: what the main thread tells an effect processor, the effects it plays from its ring, its name, the audio's time limits | Non-concern: either side's work | IO: none
export const FX_PROCESSOR = 'fx'

export const RING_SECONDS = 32
export const DELAY_SECONDS = 20

export type BufferEffect = 'roll' | 'revRoll' | 'slipRoll' | 'vBrake' | 'backSpin' | 'stretch'

export type Wave = 'saw' | 'tri'

/** Frames at the context's rate; `at` its currentTime; signed beats rise for +. */
export type FxMessage =
  | { readonly kind: 'clock'; readonly beat: number | null; readonly beatsASecond: number; readonly at: number }
  | { readonly kind: 'buffer'; readonly mode: BufferEffect | null; readonly frames: number; readonly slow: number; readonly dry: number; readonly wet: number }
  | { readonly kind: 'trans'; readonly beats: number | null; readonly cut: number; readonly open: number }
  | { readonly kind: 'crush'; readonly mix: number }
  | { readonly kind: 'pitch'; readonly ratio: number }
  | { readonly kind: 'jet'; readonly beats: number | null; readonly mix: number }
  | { readonly kind: 'mobius'; readonly beats: number | null; readonly wave: Wave; readonly level: number }
